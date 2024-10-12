import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import { StackExchangeAPI } from '@langchain/community/tools/stackexchange'
import { WikipediaQueryRun } from '@langchain/community/tools/wikipedia_query_run'
import { getFilesChangePatch, getFilesContent } from './github'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import * as core from '@actions/core'

const TOOL_RESPONSE_SUCCESS = 'SUCCESS'
const TOOL_RESPONSE_FAILED = 'FAILED'

const TAVILY_API_KEY = core.getInput('TAVILY_API_KEY', {
  required: false,
  trimWhitespace: true
})

const getFilesContentTool = tool(
  async ({ paths }) => {
    try {
      core.debug(`[get_files_full_content]: called!`)

      const fileContent = await getFilesContent(paths)

      core.debug(
        `[get_files_full_content]: ${TOOL_RESPONSE_SUCCESS}. fileContent: ${fileContent}`
      )
      return fileContent
    } catch (err) {
      core.debug(
        `[get_files_full_content]: ${TOOL_RESPONSE_FAILED}. fileContent: ${(err as Error).message}`
      )
      return 'NOT_FOUND'
    }
  },
  {
    name: 'get_files_full_content',
    description:
      'Call to get the content of specific file in the source branch to enrich your decision before reviewing specific line on that file. It will return NOT_FOUND if the file is not exists.',
    schema: z.object({
      paths: z
        .array(
          z
            .string()
            .describe(
              'Path to file (e.g <folder name>/<file name>.<file extension>'
            )
        )
        .describe(
          'The list of files paths that you want to get their full content.'
        )
    })
  }
)

const getFilesChangesPatchTool = tool(
  async ({ paths }) => {
    try {
      core.debug(`[get_files_changes_patch]: called!`)

      const fileContent = await getFilesChangePatch(paths)

      core.debug(
        `[get_files_changes_patch]: ${TOOL_RESPONSE_SUCCESS}. fileContent: ${fileContent}`
      )
      return fileContent
    } catch (err) {
      core.debug(
        `[get_files_changes_patch]: ${TOOL_RESPONSE_FAILED}. fileContent: ${(err as Error).message}`
      )
      return 'NOT_FOUND'
    }
  },
  {
    name: 'get_files_changes_patch',
    description:
      "Call to get the patch of specific file that describe it's differences between source and target branch.",
    schema: z.object({
      paths: z
        .array(
          z
            .string()
            .describe(
              'Path to file (e.g <folder name>/<file name>.<file extension>'
            )
        )
        .describe(
          'The list of files paths that you want to get their full content.'
        )
    })
  }
)

const tavilySearchToolArr = TAVILY_API_KEY
  ? [new TavilySearchResults({ maxResults: 3, apiKey: TAVILY_API_KEY })]
  : []

const stackExchangeTitleTool = new StackExchangeAPI({
  queryType: 'title'
})

const wikipediaQueryRunTool = new WikipediaQueryRun({
  topKResults: 3,
  maxDocContentLength: 4000
})

export const analysisTools = [getFilesContentTool]

export const knowledgeBaseTools = [
  ...tavilySearchToolArr,
  wikipediaQueryRunTool,
  stackExchangeTitleTool
]

export const fileSelecterAgentTools = [getFilesChangesPatchTool]

export const analysisToolsNode = new ToolNode(analysisTools)

export const knowledgeBaseToolsNode = new ToolNode(knowledgeBaseTools)

export const fileSelecterAgentToolsNode = new ToolNode(fileSelecterAgentTools)
