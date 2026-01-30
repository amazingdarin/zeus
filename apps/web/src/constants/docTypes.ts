export const DOC_TYPE_DOCUMENT = "document";
export const DOC_TYPE_OVERVIEW = "overview";
export const DOC_TYPE_SPEC = "spec";
export const DOC_TYPE_ASSET_INDEX = "asset_index";
export const DOC_TYPE_OPENAPI = "openapi";

export type DocType =
  | typeof DOC_TYPE_DOCUMENT
  | typeof DOC_TYPE_OVERVIEW
  | typeof DOC_TYPE_SPEC
  | typeof DOC_TYPE_ASSET_INDEX
  | typeof DOC_TYPE_OPENAPI;
