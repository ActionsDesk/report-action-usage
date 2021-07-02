import {join, parse} from 'path'
import {getInput, getBooleanInput, setFailed, setOutput} from '@actions/core'
import github from '@actions/github'
import FindActionUses from '@stoe/action-uses-cli'

// action
;(async () => {
  try {
    const token = getInput('token', {required: true})
    const enterprise = getInput('enterprise', {required: false}) || null
    const owner = getInput('owner', {required: false}) || null
    const csv = getInput('csv', {required: false}) || ''
    const md = getInput('md', {required: false}) || ''
    const exclude = getBooleanInput('exclude', {required: false}) || false
    const unique = getBooleanInput('unique', {required: false}) || false
    const pushToRepo = getBooleanInput('push_results_to_repo', {required: false}) || false

    if (!(enterprise || owner)) {
      throw new Error('One of enterprise, owner is required')
    }

    if (enterprise && owner) {
      throw new Error('Can only use one of enterprise, owner')
    }

    if (csv !== '') {
      const csvPath = join(process.env.GITHUB_WORKSPACE, csv)
      const {dir: csvDir} = parse(csvPath)

      if (csvDir.indexOf(process.env.GITHUB_WORKSPACE) < 0) {
        throw new Error(`${csv} is not an allowed path`)
      }
    }

    if (md !== '') {
      const mdPath = join(process.env.GITHUB_WORKSPACE, md)
      const {dir: mdDir} = parse(mdPath)

      if (mdDir.indexOf(process.env.GITHUB_WORKSPACE) < 0) {
        throw new Error(`${md} is not an allowed path`)
      }
    }

    const fau = new FindActionUses(token, enterprise, owner, null, csv, md, exclude)
    const actions = await fau.getActionUses(unique)

    const octokit = await github.getOctokit(token)
    const context = github.context

    const commitOptions = {
      ...context.repo,
      committer: {
        name: 'github-actions[bot]',
        email: '41898282+github-actions[bot]@users.noreply.github.com'
      }
    }

    // Create and save CSV
    if (csv !== '') {
      const csvOut = await fau.saveCsv(actions, unique)

      if (pushToRepo) {
        await pushFileToRepo(octokit, {
          ...commitOptions,
          path: csv,
          message: `Save/Update GitHub Actions usage report (csv)`,
          content: Buffer.from(csvOut).toString('base64')
        })
      }

      setOutput('csv_result', csvOut)
    }

    // Create and save markdown
    if (md !== '') {
      const mdOut = await fau.saveMarkdown(actions, unique)

      if (pushToRepo) {
        await pushFileToRepo(octokit, {
          ...commitOptions,
          path: md,
          message: `Save/Update GitHub Actions usage report (md)`,
          content: Buffer.from(mdOut).toString('base64')
        })
      }

      setOutput('md_result', mdOut)
    }

    setOutput('json_result', JSON.stringify(actions))
  } catch (error) {
    setFailed(error.message)
  }
})()

/**
 * @private
 *
 * @param {import('@octokit/core').Octokit} octokit
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.path
 * @param {string} options.message
 * @param {string} options.content
 */
const pushFileToRepo = async (octokit, options) => {
  try {
    const {data} = await octokit.rest.repos.getContent({
      owner: options.owner,
      repo: options.repo,
      path: options.path
    })

    if (data && data.sha) {
      options.sha = data.sha
    }

    const base = Buffer.from(data.content, 'base64')
    const head = Buffer.from(options.content, 'base64')

    // 0 if they are equal
    if (Buffer.compare(base, head) === 0) {
      console.log(`no change detected for ${options.path}`)

      // exit without updating the file
      return
    }
  } catch (error) {
    // do nothing
  }

  await octokit.rest.repos.createOrUpdateFileContents(options)
}
