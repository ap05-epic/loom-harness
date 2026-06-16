export {
  parseStrutsConfig,
  type StrutsConfig,
  type StrutsAction,
  type StrutsForward,
  type StrutsFormBean,
} from './struts-parser.js';
export {
  parseJsp,
  type JspInfo,
  type JspTaglib,
  type JspForm,
  type JspFormField,
  type JspIterate,
} from './jsp-parser.js';
export {
  parseTilesDefs,
  type TilesConfig,
  type TileDefinition,
  type TileAttribute,
} from './tiles-parser.js';
export { parseWebXml, type WebXml, type WebServlet, type WebFilter } from './webxml-parser.js';
export {
  openCodeAtlas,
  CodeAtlas,
  screenKeyFromAction,
  CODEATLAS_MIGRATIONS,
  type CaNode,
  type Screen,
  type ScreenSlice,
} from './codeatlas.js';
export {
  ingestStrutsConfig,
  ingestTiles,
  ingestWebXml,
  ingestJsp,
  ingestLegacyWebapp,
  mapProject,
  type MapProjectOptions,
  type LegacySources,
  type LegacyJsp,
} from './map.js';
export { repoMap, type RepoMapOptions } from './repo-map.js';
export { codeAtlasMcpServer } from './codeatlas-mcp.js';
export { discoverLegacyWebapp, type DiscoveredWebapp } from './discover.js';
export {
  summarizeScreens,
  screenEvidence,
  type SummarizeOptions,
  type SummarizeResult,
} from './summarize.js';
export {
  verifyScreenDocs,
  type VerifyDocsOptions,
  type VerifyDocsResult,
  type DocVerification,
} from './verify-docs.js';
