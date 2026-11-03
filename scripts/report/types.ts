export type ReportBlock =
  | {
      kind: 'p';
      text: string;
    }
  | {
      kind: 'bullets';
      items: string[];
    }
  | {
      kind: 'numbered';
      items: string[];
    }
  | {
      kind: 'callout';
      title: string;
      text: string;
    }
  | {
      kind: 'table';
      tableNumber: string;
      caption: string;
      headers: string[];
      rows: string[][];
      colWidths?: number[]; // relative weights summing to ~100
    }
  | {
      kind: 'figure';
      figureNumber: string;
      caption: string;
      imagePath: string; // relative to workspace root, e.g. docs/reports/diagrams/fig01_architecture.png
      sourceNote?: string;
    }
  | {
      kind: 'code';
      title: string;
      filePath: string;
      language: string;
      code: string;
    };

export interface ReportSubSection {
  number: string; // e.g. "1.1.1" or ""
  title: string;
  blocks: ReportBlock[];
}

export interface ReportSection {
  number: string; // e.g. "1.1"
  title: string;
  blocks: ReportBlock[];
  subsections?: ReportSubSection[];
}

export interface ReportChapter {
  id: string;
  chapterLabel: string; // e.g. "CHAPTER 1" or "APPENDIX A" or "PRELIMINARY"
  number: string; // e.g. "1" or "Appendix A"
  title: string; // Exact prescribed college heading, e.g. "ABOUT THE SYSTEM"
  isPreliminary?: boolean;
  isAppendix?: boolean;
  blocks?: ReportBlock[];
  sections: ReportSection[];
}

export interface ReportDocumentModel {
  metadata: {
    projectTitle: string;
    projectSubtitle: string;
    corePrinciple: string;
    degreeProgram: string;
    departmentPlaceholder: string;
    institutionPlaceholder: string;
    universityPlaceholder: string;
    academicYearPlaceholder: string;
    guidePlaceholder: string;
    hodPlaceholder: string;
    studentsPlaceholder: Array<{ name: string; rollNo: string }>;
    repositoryUrl: string;
    activeBranch: string;
  };
  abbreviations: Array<{ abbr: string; full: string; context: string }>;
  preliminary: {
    certificateText: string[];
    declarationText: string[];
    acknowledgementText: string[];
    abstractParagraphs: string[];
    keywords: string[];
  };
  chapters: ReportChapter[];
}
