export type Language = "en" | "hi";
export type QuestionType = "mcq" | "comprehension" | "table" | "image" | "map" | "matrix";
export type QuestionStatus = "draft" | "needs_correction" | "content_verified" | "answer_pending" | "ready_for_approval" | "published" | "rejected";
export type AnswerStatus = "pending" | "single_correct" | "multiple_correct" | "all_options_correct" | "dropped" | "disputed";
export type ExamSession = "June" | "December" | "Other";

export interface ContentBlock {
  type: "paragraph" | "table" | "image" | "math" | "list" | "html";
  text?: string;
  html?: string;
  latex?: string;
  columns?: string[];
  rows?: string[][];
  assetPath?: string;
  alt?: string;
}
export interface QuestionOption {
  key: "A" | "B" | "C" | "D";
  content: ContentBlock[];
}
export interface SyllabusClassification {
  nodeId: string;
  isPrimary?: boolean;
}
export interface ExamAppearance {
  appearanceId: string;
  year: number;
  session: ExamSession;
  examEventType: "regular" | "re_exam" | "special" | "unknown";
  subjectCode: string;
  paperNumber: 1 | 2;
  shift?: string;
  examDate?: string;
  originalQuestionNumber: string;
  ntaQuestionId?: string;
  sourceDocumentId?: string;
  sourcePage?: number;
}
export interface LocalizedQuestion {
  language: Language;
  stem: ContentBlock[];
  options: QuestionOption[];
  instructions?: ContentBlock[];
}
export interface QuestionRecord {
  questionId: string;
  subjectCode: string;
  questionType: QuestionType;
  status: QuestionStatus;
  localized: LocalizedQuestion[];
  classifications: SyllabusClassification[];
  appearances: ExamAppearance[];
  answerStatus: AnswerStatus;
  correctOptionKeys?: string[];
  explanation?: { overview?: string; richText?: string; optionExplanations?: Record<string, string>; references?: Array<{title:string;author?:string;edition?:string;page?:string}> };
  sourceProvenance: Array<{sourceDocumentId:string;sourceType:"nta_official"|"private_solution"|"official_answer_key"|"editorial";page?:number;sourceQuestionNumber?:string}>;
}

export interface TestBlueprint {
  id: string;
  name: string;
  mode: "geography_only" | "full_ugc_net" | "custom" | "historical_paper";
  paperIQuestionCount: number;
  paperIIQuestionCount: number;
  durationMinutes: number;
  marksPerCorrect: number;
  marksPerWrong: number;
  marksPerUnattempted: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
}

export const CURRENT_FULL_MOCK: TestBlueprint = {
  id: "ugc-net-current-full-mock", name: "Complete UGC NET Mock", mode: "full_ugc_net",
  paperIQuestionCount: 50, paperIIQuestionCount: 100, durationMinutes: 180,
  marksPerCorrect: 2, marksPerWrong: 0, marksPerUnattempted: 0, shuffleQuestions: true, shuffleOptions: false
};
export const GEOGRAPHY_PRACTICE: TestBlueprint = {
  id: "geography-100-120", name: "Geography Paper II Practice", mode: "geography_only",
  paperIQuestionCount: 0, paperIIQuestionCount: 100, durationMinutes: 120,
  marksPerCorrect: 2, marksPerWrong: 0, marksPerUnattempted: 0, shuffleQuestions: true, shuffleOptions: false
};

export function flattenSyllabus(tree: any): Array<{id:string;title:string;type:string;parentId:string|null;path:string[]}> {
  const result: Array<{id:string;title:string;type:string;parentId:string|null;path:string[]}> = [];
  const walk = (node:any, type:string, parentId:string|null, path:string[]) => {
    result.push({id:node.id,title:node.title,type,parentId,path:[...path,node.title]});
    for (const section of node.sections ?? []) {
      walk(section,"section",node.id,[...path,node.title]);
      for (const topic of section.topics ?? []) {
        result.push({id:topic.id,title:topic.title,type:"topic",parentId:section.id,path:[...path,node.title,section.title,topic.title]});
        for (const [i, sub] of (topic.subtopics ?? []).entries()) {
          result.push({id:`${topic.id}-S${String(i+1).padStart(2,"0")}`,title:sub,type:"subtopic",parentId:topic.id,path:[...path,node.title,section.title,topic.title,sub]});
        }
      }
    }
  };
  for (const unit of tree.units ?? []) walk(unit,"unit",null,[]);
  return result;
}
