/**
 * PPT Generation Types
 *
 * Type definitions for the Banana Slides PPT generation service.
 */

/**
 * Slide content extracted from Tiptap document
 */
export interface SlideContent {
  index: number;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  paragraphs?: string[];
  codeBlocks?: { language: string; code: string }[];
  images?: string[];
  notes?: string;
}

/**
 * Style template definition
 */
export interface StyleTemplate {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  templateImages?: string[];
  colorScheme?: ColorScheme;
}

/**
 * Color scheme for PPT styling
 */
export interface ColorScheme {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent?: string;
}

/**
 * Style options for PPT generation
 */
export interface StyleOptions {
  /** Text description of desired style */
  description?: string;
  /** Preset template ID */
  templateId?: string;
  /** Custom template images for style transfer */
  templateImages?: string[];
  /** Custom color scheme */
  colorScheme?: ColorScheme;
}

/**
 * PPT generation request
 */
export interface GeneratePPTRequest {
  /** Slides content */
  slides: SlideContent[];
  /** Style options */
  style?: StyleOptions;
  /** Additional options */
  options?: GenerateOptions;
}

/**
 * Additional generation options
 */
export interface GenerateOptions {
  /** Aspect ratio */
  aspectRatio?: "16:9" | "4:3";
  /** Language for generated content */
  language?: string;
  /** Whether to generate speaker notes */
  generateNotes?: boolean;
}

/**
 * Task status for async generation
 */
export type TaskStatusType = "pending" | "processing" | "completed" | "failed";

/**
 * Task status response
 */
export interface TaskStatus {
  taskId: string;
  status: TaskStatusType;
  progress?: number;
  currentSlide?: number;
  totalSlides?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Generation result
 */
export interface GenerateResult {
  taskId: string;
  status: TaskStatusType;
  /** Download URL when completed */
  downloadUrl?: string;
  /** Preview images for each slide */
  previews?: string[];
}

/**
 * Slide input for Banana Slides API
 */
export interface BananaSlideInput {
  index: number;
  content: string;
  notes?: string;
  style?: {
    templateId?: string;
    description?: string;
  };
}

/**
 * Banana Slides API request
 */
export interface BananaGenerateRequest {
  slides: BananaSlideInput[];
  style?: {
    templateId?: string;
    description?: string;
    templateImages?: string[];
  };
  options?: {
    aspectRatio?: string;
    language?: string;
  };
}

/**
 * Banana Slides API response
 */
export interface BananaGenerateResponse {
  taskId: string;
  status: string;
  message?: string;
}

/**
 * Banana Slides task status response
 */
export interface BananaTaskStatusResponse {
  taskId: string;
  status: string;
  progress?: number;
  downloadUrl?: string;
  previews?: string[];
  error?: string;
}

/**
 * Modify slide request
 */
export interface ModifySlideRequest {
  pptId: string;
  slideIndex: number;
  instruction: string;
}

/**
 * Preset template info
 */
export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  previewUrl?: string;
}

/**
 * List of available preset templates
 */
export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "tech-dark",
    name: "科技深色",
    description: "深蓝渐变，适合技术分享",
  },
  {
    id: "corp-blue",
    name: "商务蓝",
    description: "蓝白配色，适合企业汇报",
  },
  {
    id: "minimal-light",
    name: "极简浅色",
    description: "黑白灰，适合学术报告",
  },
  {
    id: "creative-gradient",
    name: "创意渐变",
    description: "多彩渐变，适合创意展示",
  },
  {
    id: "nature-green",
    name: "自然绿",
    description: "绿色系，适合环保/教育",
  },
];
