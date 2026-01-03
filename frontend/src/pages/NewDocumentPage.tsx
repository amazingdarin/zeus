import { useState } from "react";
import type { JSONContent } from "@tiptap/react";

import RichTextEditor from "../components/RichTextEditor";

function NewDocumentPage() {
  const [content, setContent] = useState<JSONContent | null>(null);
  const [title, setTitle] = useState("Untitled Document");
  const [description, setDescription] = useState("");

  const payload = {
    title,
    description,
    content,
  };

  return (
    <div className="new-doc-page">
      <div className="new-doc-header">
        <button className="btn primary" type="button">
          Save
        </button>
      </div>
      <div className="new-doc-metadata">
        <input
          className="kb-title-input new-doc-title-input"
          type="text"
          value={title}
          placeholder="Document title"
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="kb-description-input new-doc-description-input"
          value={description}
          placeholder="Add a short description"
          rows={2}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <RichTextEditor onChange={setContent} />
      <div className="new-doc-json">
        <div className="new-doc-json-title">Document JSON</div>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </div>
  );
}

export default NewDocumentPage;
