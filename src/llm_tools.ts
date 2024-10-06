import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import { StackExchangeAPI } from '@langchain/community/tools/stackexchange'
import { WikipediaQueryRun } from '@langchain/community/tools/wikipedia_query_run'
import { getFileChangePatch, getFileContent } from './github'
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

const getFileContentTool = tool(
  async ({ path }) => {
    try {
      core.debug(`[get_file_content]: called!`)

      const fileContent = await getFileContent(path)

      core.debug(
        `[get_file_content]: ${TOOL_RESPONSE_SUCCESS}. fileContent: ${fileContent}`
      )
      return fileContent
    } catch (err) {
      core.debug(
        `[get_file_content]: ${TOOL_RESPONSE_FAILED}. fileContent: ${(err as Error).message}`
      )
      return 'NOT_FOUND'
    }
  },
  {
    name: 'get_file_full_content',
    description:
      'Call to get the content of specific file in the source branch to enrich your decision before reviewing specific line on that file. It will return NOT_FOUND if the file is not exists.',
    schema: z.object({
      path: z
        .string()
        .describe(
          'Path to file (e.g <folder name>/<file name>.<file extension>'
        )
    })
  }
)

const getFileChangesPatchTool = tool(
  async ({ path }) => {
    try {
      core.debug(`[get_file_content]: called!`)

      const fileContent = await getFileChangePatch(path)

      core.debug(
        `[get_file_content]: ${TOOL_RESPONSE_SUCCESS}. fileContent: ${fileContent}`
      )
      return fileContent
    } catch (err) {
      core.debug(
        `[get_file_content]: ${TOOL_RESPONSE_FAILED}. fileContent: ${(err as Error).message}`
      )
      return 'NOT_FOUND'
    }
  },
  {
    name: 'get_file_changes_patch',
    description:
      "Call to get the patch of specific file that describe it's differences between source and target branch.",
    schema: z.object({
      path: z
        .string()
        .describe(
          'Path to file (e.g <folder name>/<file name>.<file extension>'
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

export const analysisTools = [
  getFileContentTool,
  ...tavilySearchToolArr,
  wikipediaQueryRunTool,
  stackExchangeTitleTool
]

export const knowledgeBaseTools = [
  getFileContentTool,
  ...tavilySearchToolArr,
  wikipediaQueryRunTool,
  stackExchangeTitleTool
]

export const fileSelecterAgentTools = [
  getFileChangesPatchTool,
  getFileContentTool
]

export const analysisToolsNode = new ToolNode(analysisTools)

export const knowledgeBaseToolsNode = new ToolNode(knowledgeBaseTools)

export const fileSelecterAgentToolsNode = new ToolNode(fileSelecterAgentTools)
