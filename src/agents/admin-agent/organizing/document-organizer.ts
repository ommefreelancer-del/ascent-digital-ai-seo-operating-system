// Organizes real, caller-supplied internal documents -- per the spec's
// "Organize project documentation" responsibility. A deterministic sort by
// category then name; never invents a document or alters its real metadata.

import type { InternalDocumentEntry, OrganizedDocumentEntry } from "../types/admin-request.types.js";

export class DocumentOrganizer {
  build(internalDocuments: readonly InternalDocumentEntry[]): OrganizedDocumentEntry[] {
    return [...internalDocuments]
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
      .map((doc) => ({ name: doc.name, category: doc.category, lastUpdatedAt: doc.lastUpdatedAt }));
  }
}
