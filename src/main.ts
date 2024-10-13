import * as core from '@actions/core'
import { isNeedToReviewPullRequest } from './github'
import { reviewPullRequest } from './llm'

export async function run(): Promise<void> {
  if (isNeedToReviewPullRequest() || isNeedToReviewPullRequest()) {
    core.info('[main] - Reviewing pull request...')

    try {
      await reviewPullRequest()
    } catch (error) {
      core.setFailed((error as Error).message)
    }
  } else {
    core.info(
      '[main] - Skipping review, this action will only review opened, synced, and re-opened pull request. And also when there is comment to review created or edited.'
    )
  }
}
