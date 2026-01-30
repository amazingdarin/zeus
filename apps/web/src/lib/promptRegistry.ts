export type PromptTemplate = {
  id: string;
  title: string;
  description?: string;
  template: string;
};

const promptTemplates: PromptTemplate[] = [
  {
    id: "propose",
    title: "Propose knowledge base changes",
    description: "Draft a change proposal for a document",
    template: "Propose updates for the referenced document:\n{{doc:ID|title:TITLE}}\n{{input}}",
  },
  {
    id: "kb-refactor",
    title: "Refactor knowledge base content",
    description: "Rewrite a document for clarity and structure",
    template:
      "Refactor this knowledge base document for clarity and structure:\n{{doc:ID|title:TITLE}}",
  },
  {
    id: "api-summary",
    title: "Summarize API repository",
    description: "Create a concise summary for the API repo",
    template: "Summarize this API repository:\n{{repo:ID}}",
  },
];

export const listPromptTemplates = () => promptTemplates.slice();

export const findPromptTemplate = (id: string) =>
  promptTemplates.find((template) => template.id === id);

export const filterPromptTemplates = (query: string) => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return listPromptTemplates();
  }
  return promptTemplates.filter((template) => {
    return (
      template.id.toLowerCase().includes(needle) ||
      template.title.toLowerCase().includes(needle)
    );
  });
};
