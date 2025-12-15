import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { PaperSectionType, UploadedFile, HumanizeLevel, QualityChecklist } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

// Helper to clean base64 string
const cleanBase64 = (b64: string) => b64.replace(/^data:.+;base64,/, '');

// Helper to decode base64 text content
const decodeBase64Text = (b64: string): string => {
  try {
    const binaryString = atob(b64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.warn("Failed to decode text file", e);
    return "";
  }
};

// Retry logic with exponential backoff
const callWithRetry = async <T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const msg = error.message?.toLowerCase() || "";
    // Retry on rate limits (429), server errors (503), or quota exhaustion (if temporary)
    const isRetryable = msg.includes('429') || 
                        msg.includes('503') || 
                        msg.includes('quota') || 
                        msg.includes('resource exhausted') || 
                        msg.includes('rate limit');

    if (isRetryable && retries > 0) {
      console.warn(`API Limit hit (${msg}). Retrying in ${delayMs}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
};

const prepareFileParts = (files: UploadedFile[]) => {
  return files.map(f => {
    const data = cleanBase64(f.data);
    if (f.type.includes('pdf')) {
      return {
        inlineData: {
          mimeType: 'application/pdf',
          data: data
        }
      };
    } else if (f.type.includes('text') || f.name.endsWith('.txt') || f.name.endsWith('.md')) {
      const text = decodeBase64Text(data);
      return {
        text: `[Source Document: ${f.name}]\n${text}\n---`
      };
    }
    return null;
  }).filter(p => p !== null);
};

// Interface for the AI JSON response
interface AnalysisResult {
  title: string;
  target_journal: string;
  gap: string;
  novelty: string;
  methodology_plan: string;
  expected_results: string;
  checklist: QualityChecklist;
}

export const analyzeFilesForNovelty = async (files: UploadedFile[]): Promise<AnalysisResult> => {
  const ai = getAI();
  const fileParts = prepareFileParts(files);

  if (fileParts.length === 0) {
    throw new Error("No valid PDF or Text files found to analyze.");
  }

  // THE CPO Q1 ANALYSIS PROMPT
  const prompt = `
    You are an AI-powered Chief Publication Officer (CPO). Your goal is to analyze the provided resources and synthesize a complete, Q1 Journal-Ready Manuscript Blueprint.
    
    **GUIDELINES:**
    1. **Preliminary Analysis:** Identify SOTA Weaknesses/Gaps. If resources are sparse, automatically select a Cross-Domain Topic (e.g., Causal ML x LLM).
    2. **Target:** Select a specific Q1 Venue (e.g., IEEE T-PAMI, Nature Electronics, JMLR).
    3. **Writing Order 2A Logic:** Ensure the blueprint flows: Problem -> Solution -> Validation -> Implication.
    
    **TASK: Generate a JSON object containing:**
    1. **title**: Informative and catchy Q1 title.
    2. **target_journal**: Specific Q1 journal name.
    3. **gap**: The critical Research Gap (SOTA limitations).
    4. **novelty**: The Contribution (Bullet points of specific contributions).
    5. **methodology_plan**: Brief on Architecture & Mathematical Rigor (Mention Loss Functions like $L_{total}$).
    6. **expected_results**: Clear Claim (e.g., Superior robustness).
    7. **checklist**: A "Reviewer Focus Check" object with:
       - **novelty_check**: Is the cross-domain combination unique?
       - **significance_check**: Is the Impact Factor high enough?
       - **clarity_check**: Is the Problem Statement clear/concise?
       - **journal_fit_check**: Why does this strictly fit the chosen journal's scope?
  `;

  try {
    const response = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-3-pro-preview', 
      contents: {
        parts: [...fileParts, { text: prompt }]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            target_journal: { type: Type.STRING },
            gap: { type: Type.STRING },
            novelty: { type: Type.STRING },
            methodology_plan: { type: Type.STRING },
            expected_results: { type: Type.STRING },
            checklist: {
              type: Type.OBJECT,
              properties: {
                novelty_check: { type: Type.STRING },
                significance_check: { type: Type.STRING },
                clarity_check: { type: Type.STRING },
                journal_fit_check: { type: Type.STRING }
              },
              required: ["novelty_check", "significance_check", "clarity_check", "journal_fit_check"]
            }
          },
          required: ["title", "target_journal", "gap", "novelty", "methodology_plan", "expected_results", "checklist"]
        }
      }
    }));

    if (!response.text) throw new Error("Empty response from AI");
    
    const result = JSON.parse(response.text);
    return result;
  } catch (error: any) {
    console.error("Error analyzing files:", error);
    throw new Error(error.message || "Failed to analyze documents.");
  }
};

export const generateSectionContent = async (
  sectionType: PaperSectionType,
  context: {
    files: UploadedFile[],
    title: string,
    gap: string,
    novelty: string,
    targetJournal: string,
    methodologyPlan: string,
    expectedResults: string,
    otherSections: { type: string, content: string }[]
  }
): Promise<string> => {
  const ai = getAI();
  const fileParts = prepareFileParts(context.files);

  const previousContext = context.otherSections
    .map(s => `[${s.type} Summary]: ${s.content.substring(0, 500)}...`)
    .join('\n');

  // THE CPO WRITING PROMPT
  const prompt = `
    Act as the Chief Publication Officer writing a manuscript for **${context.targetJournal}** (Q1).
    
    **Paper Metadata:**
    - **Title:** ${context.title}
    - **Contribution:** ${context.novelty}
    - **Methodology:** ${context.methodologyPlan}
    
    **Task:** Write the **${sectionType}** section.
    
    **Strict CPO Guidelines (Writing Order 2A & Principles 3):**
    1.  **Turnitin-Safe:** Content must be 100% original, synthesized from sources, not copied.
    2.  **Logic Flow:**
        - If Intro: Problem Statement -> Research Gap -> Contribution bullets.
        - If Related Work: Critical Analysis (Last 5 years) -> Differentiate your work.
        - If Methodology: Transparent Method -> Mathematical Rigor ($LaTeX$ for Loss Functions: e.g., $\\mathcal{L}_{total}$).
        - If Results: Comparative Analysis vs 3 Baselines -> Clear Claim (No overclaiming).
    3.  **Tone:** Scientific Rigor, Formal, Ethical.
    4.  **Formatting:** Markdown.
    
    **Context:**
    ${previousContext}
  `;

  try {
    const response = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [...fileParts, { text: prompt }]
      }
    }));

    return response.text || "Failed to generate content.";
  } catch (error: any) {
    console.error(`Error generating ${sectionType}:`, error);
    return `Error generating content: ${error.message}. Please try again later.`;
  }
};

export const humanizeText = async (text: string, level: HumanizeLevel): Promise<string> => {
  const ai = getAI();

  let styleInstruction = "";
  if (level === 'Standard') {
    styleInstruction = "Improve flow, grammar, and clarity. Remove passive voice where appropriate.";
  } else if (level === 'Academic-Flow') {
    styleInstruction = "Use sophisticated academic transitions (e.g., 'Conversely', 'Furthermore', 'Notwithstanding'). Ensure paragraphs flow logically. Use varied sentence structures.";
  } else if (level === 'High-Burstiness') {
    styleInstruction = "Maximize 'burstiness' and 'perplexity' to bypass AI detection. Mix very short, punchy sentences with long, intricate ones. Use specific, non-cliché vocabulary. Make it sound like a passionate human expert.";
  }

  const prompt = `
    Refine the following text for a Q1 journal submission.
    
    **Goal:** ${level}
    **Instructions:** ${styleInstruction}
    **Constraint:** Do not lose the technical details or citations.
    
    **Original Text:**
    ${text}
  `;

  try {
    const response = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    }));

    return response.text || text;
  } catch (error: any) {
    console.error("Error humanizing text:", error);
    throw new Error(error.message || "Failed to refine text");
  }
};