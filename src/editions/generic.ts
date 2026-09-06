import { createContentProvider, createStaticCatalogProvider, createStaticMetadataProvider, createStaticSearchProvider } from "./providers";
import type { EditionDefinition } from "./types";

const edition: EditionDefinition = {
  id: "generic",
  brand: {
    name: "Virtual Library",
    shortName: "Virtual Library",
    catalogueLabel: "Library catalogue",
    volumeLabel: "books"
  },
  storageNamespace: "virtual-library",
  defaultScopeId: "local",
  scopes: [
    {
      id: "local",
      label: "Local Library",
      shortLabel: "Local",
      description: "Markdown files discovered in the books folder."
    }
  ],
  browseFacetIds: ["authors", "categories", "tags"],
  suggestedQueries: ["introduction", "history", "science", "art", "technology"],
  catalogProvider: createStaticCatalogProvider(),
  metadataProvider: createStaticMetadataProvider(),
  contentProvider: createContentProvider(),
  searchProvider: createStaticSearchProvider()
};

export default edition;
