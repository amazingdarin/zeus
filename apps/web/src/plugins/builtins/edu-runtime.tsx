import type { EditorBlockContribution } from "@zeus/plugin-sdk-web";
import { EduQuestionSetButton, EduQuestionSetNode } from "@zeus/doc-editor";

export function createEduQuestionSetBlockContribution(
  reactCreateElement: (...args: unknown[]) => unknown,
): EditorBlockContribution {
  return {
    id: "edu-question-set-block",
    blockType: "edu_question_set",
    title: "Edu Question Set",
    requiresBlockId: true,
    extension: EduQuestionSetNode,
    toolbarButton: reactCreateElement(EduQuestionSetButton, { text: "题组" }),
  };
}

export { EduQuestionSetButton, EduQuestionSetNode };
