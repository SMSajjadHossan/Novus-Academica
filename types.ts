export interface UploadedFile {
  name: string;
  type: string;
  data: string; // Base64
}

export enum PaperSectionType {
  Title = 'Title',
  Abstract = 'Abstract',
  Introduction = 'Introduction',
  LiteratureReview = 'Literature Review',
  Methodology = 'Methodology',
  Results = 'Results',
  Discussion = 'Discussion',
  Conclusion = 'Conclusion',
  References = 'References'
}

export interface PaperSection {
  id: string;
  type: PaperSectionType;
  title: string;
  content: string;
  isGenerating: boolean;
  notes: string;
}

export interface QualityChecklist {
  novelty_check: string;
  significance_check: string;
  clarity_check: string;
  journal_fit_check: string;
}

export interface ResearchState {
  files: UploadedFile[];
  paperTitle: string;
  // Deep Analysis Data
  researchGap: string;
  noveltyClaim: string;
  targetJournal: string;
  methodologyPlan: string;
  expectedResults: string;
  qualityChecklist: QualityChecklist | null;
  
  sections: PaperSection[];
  activeSectionId: string | null;
}

export type HumanizeLevel = 'Standard' | 'Academic-Flow' | 'High-Burstiness';