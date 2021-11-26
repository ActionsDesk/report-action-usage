import {context, getOctokit} from '@actions/github'
import {getBooleanInput, getInput, setFailed, setOutput} from '@actions/core'
import {join, parse} from 'path'
import FindActionUses from '@stoe/action-uses-cli/utils/action-uses'

// action
;(async () => {
  try {
    const token = getInput('token', {required: true})
    const enterprise = getInput('enterprise', {required: false}) || null
    const owner = getInput('owner', {required: false}) || null
    const csv = getInput('csv', {required: false}) || ''
    const md = getInput('md', {required: false}) || ''
    const exclude = getBooleanInput('exclude', {required: false}) || false
    const _unique = getInput('unique', {required: false}) || false
    const pushToRepo = getBooleanInput('push_results_to_repo', {required: false}) || false

    if (!(enterprise || owner)) {
      throw new Error('Please provide a valid value: enterprise or owner')
    }

    if (enterprise && owner) {
      throw new Error('Can only use one of: enterprise, owner')
    }

    const uniqueFlag = _unique === 'both' ? 'both' : _unique === 'true'
    if (![true, false, 'both'].includes(uniqueFlag)) {
      throw new Error('Please provide a valid value for unique: true, false, both')
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

    const fau = new FindActionUses(token, enterprise, owner, null, csv, md, uniqueFlag, exclude)
    const {actions, unique} = await fau.getActionUses(uniqueFlag)

    const octokit = await getOctokit(token)

    const commitOptions = pushToRepo
      ? {
          ...context.repo,
          committer: {
            name: 'github-actions[bot]',
            email: '41898282+github-actions[bot]@users.noreply.github.com'
          }
        }
      : {}

    // Create and save CSV
    if (csv !== '') {
      const csvResult = await fau.saveCsv({actions, unique}, uniqueFlag)

      if (csvResult !== false) {
        const {csv: csvOut, csvUnique: csvUniqueOut} = csvResult
        const csvPathUnique = `${csv.replace('.csv', '-unique.csv')}`

        if (pushToRepo) {
          await pushFileToRepo(octokit, {
            ...commitOptions,
            path: csv,
            message: `Save/Update GitHub Actions usage report (csv)`,
            content: Buffer.from(csvOut).toString('base64')
          })

          if (uniqueFlag === 'both') {
            await pushFileToRepo(octokit, {
              ...commitOptions,
              path: csvPathUnique,
              message: `Save/Update GitHub Actions usage report (csv)`,
              content: Buffer.from(csvUniqueOut).toString('base64')
            })
          }
        }

        setOutput('csv_result', csvOut)

        if (uniqueFlag === 'both') {
          setOutput('csv_resul_unique', csvUniqueOut)
        }
      }
    }

    // Create and save markdown
    if (md !== '') {
      const mdResult = await fau.saveMarkdown({actions, unique}, uniqueFlag)

      if (mdResult !== false) {
        const {md: mdOut, mdUnique: mdUniqueOut} = mdResult
        const mdPathUnique = `${md.replace('.md', '-unique.md')}`

        if (pushToRepo) {
          await pushFileToRepo(octokit, {
            ...commitOptions,
            path: md,
            message: `Save/Update GitHub Actions usage report (md)`,
            content: Buffer.from(mdOut).toString('base64')
          })

          if (uniqueFlag === 'both') {
            await pushFileToRepo(octokit, {
              ...commitOptions,
              path: mdPathUnique,
              message: `Save/Update GitHub Actions usage report (md)`,
              content: Buffer.from(mdUniqueOut).toString('base64')
            })
          }
        }

        setOutput('md_result', mdOut)

        if (uniqueFlag === 'both') {
          setOutput('md_result_unique', mdUniqueOut)
        }
      }
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

  // https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
  await octokit.rest.repos.createOrUpdateFileContents(options)
}
