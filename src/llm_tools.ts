import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import { StackExchangeAPI } from '@langchain/community/tools/stackexchange'
import { WikipediaQueryRun } from '@langchain/community/tools/wikipedia_query_run'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import * as core from '@actions/core'

const TAVILY_API_KEY = core.getInput('TAVILY_API_KEY', {
  required: false,
  trimWhitespace: true
})

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

export const knowledgeBaseTools = [
  ...tavilySearchToolArr,
  wikipediaQueryRunTool,
  stackExchangeTitleTool
]

export const knowledgeBaseToolsNode = new ToolNode(knowledgeBaseTools)
