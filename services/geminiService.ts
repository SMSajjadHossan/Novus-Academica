import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { PaperSectionType, UploadedFile, HumanizeLevel, QualityChecklist, MagicToolType, ChatMessage } from "../types";

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

const callWithRetry = async <T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const msg = error.message?.toLowerCase() || "";
    // Detect quota or rate limit errors
    const isRetryable = msg.includes('429') || msg.includes('503') || msg.includes('quota') || msg.includes('resource exhausted');
    
    if (isRetryable && retries > 0) {
      console.warn(`API Limit hit (${msg}). Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
};

const prepareFilePart = (file: UploadedFile) => {
  const data = cleanBase64(file.data);
  if (file.type.includes('pdf')) {
    return { inlineData: { mimeType: 'application/pdf', data: data } };
  } else if (file.type.includes('text') || file.name.endsWith('.txt') || file.name.endsWith('.md') || file.name.endsWith('.tex') || file.name.endsWith('.latex')) {
    const text = decodeBase64Text(data);
    return { text: `[Source Document: ${file.name}]\n${text}\n---` };
  }
  return null;
};

interface AnalysisResult {
  title: string;
  target_journal: string;
  gap: string;
  novelty: string;
  methodology_plan: string;
  expected_results: string;
  checklist: QualityChecklist;
  references: string[];
}

// 1. Summarization Helper (Lightweight Model)
const summarizeFile = async (file: UploadedFile): Promise<string> => {
  const ai = getAI();
  const part = prepareFilePart(file);
  if (!part) return "";

  const prompt = `
    Analyze this research document. Extract:
    1. Core Research Question
    2. Key Methodology/Techniques
    3. Main Findings/Claims
    4. Any important citations (Author, Year)
    
    Output strictly as a concise summary text.
  `;

  try {
    // Use Flash for summarization - cheaper and faster
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [part, { text: prompt }] }
    });
    return `[Summary of ${file.name}]:\n${response.text}\n---\n`;
  } catch (e) {
    console.warn(`Failed to summarize ${file.name}, skipping.`, e);
    return "";
  }
};

export const analyzeFilesForNovelty = async (files: UploadedFile[]): Promise<AnalysisResult> => {
  const ai = getAI();
  
  // 2. Decide Strategy: Direct Analysis vs. Map-Reduce
  // If > 2 files, use Map-Reduce to save tokens/quota
  let processingParts: any[] = [];
  
  if (files.length > 2) {
    console.log("Creating summaries for efficient analysis...");
    // Process sequentially to avoid rate limits during summarization
    const summaries: string[] = [];
    for (const file of files) {
      const summary = await summarizeFile(file);
      summaries.push(summary);
      // Small delay between chunks to be nice to the API
      await new Promise(r => setTimeout(r, 500));
    }
    const combinedContext = summaries.join("\n");
    processingParts = [{ text: "Here are summaries of the provided source materials:\n" + combinedContext }];
  } else {
    // Direct mode for few files
    processingParts = files.map(prepareFilePart).filter(p => p !== null);
  }

  const prompt = `
    You are an AI-powered Chief Publication Officer (CPO). Analyze the resources for a Q1 Journal Manuscript.
    
    **GUIDELINES:**
    1. Identify SOTA Weaknesses/Gaps based on the provided materials.
    2. Select a specific Q1 Venue.
    3. Ensure Logic Flow: Problem -> Solution -> Validation -> Implication.
    4. **Extract Sources:** Look for key papers cited in the text/summaries and list them.
    
    **Return JSON:**
    {
      "title": "High-impact title",
      "target_journal": "Journal Name",
      "gap": "Research Gap",
      "novelty": "Bullet points of contribution",
      "methodology_plan": "Math/Architecture brief",
      "expected_results": "Hypothesis/Claims",
      "checklist": { "novelty_check": "...", "significance_check": "...", "clarity_check": "...", "journal_fit_check": "..." },
      "references": ["Author, Year, Title", ...]
    }
  `;

  const config = {
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
          }
        },
        references: { type: Type.ARRAY, items: { type: Type.STRING } }
      }
    }
  };

  // 3. Robust Execution with Fallback
  // Try Pro first for quality, Fallback to Flash for reliability/quota
  try {
    const response = await callWithRetry(() => ai.models.generateContent({
      model: 'gemini-3-pro-preview', 
      contents: { parts: [...processingParts, { text: prompt }] },
      config
    }));
    return JSON.parse(response.text || "{}");
  } catch (error: any) {
    console.warn("Pro model failed (likely quota), falling back to Flash.", error);
    
    try {
      const fallbackResponse = await callWithRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash', // Fallback model
        contents: { parts: [...processingParts, { text: prompt }] },
        config
      }));
      return JSON.parse(fallbackResponse.text || "{}");
    } catch (finalError: any) {
      throw new Error(`Analysis failed after retries: ${finalError.message}`);
    }
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
    otherSections: { type: string, content: string }[]
  }
): Promise<string> => {
  const ai = getAI();
  
  // To avoid quota on drafting, we stick to Flash for generation
  // We also limit context to avoid payload errors if files are huge
  const fileParts = filesToPartsLimited(context.files);
  const previousContext = context.otherSections.map(s => `[${s.type}]: ${s.content.substring(0, 500)}...`).join('\n');

  const prompt = `
    Act as CPO writing for ${context.targetJournal} (Q1).
    Title: ${context.title}
    Contribution: ${context.novelty}
    Methodology: ${context.methodologyPlan}
    
    Task: Write ${sectionType} section.
    Rules: 100% Original (Turnitin-Safe), Mathematical Rigor (LaTeX), Formal Tone.
    Context: ${previousContext}
  `;

  try {
    const response = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash', // Always use Flash for drafting
      contents: { parts: [...fileParts, { text: prompt }] }
    }));
    return response.text || "Failed.";
  } catch (error: any) {
    return `Error: ${error.message}`;
  }
};

// Helper to avoid sending too much data in section generation
const filesToPartsLimited = (files: UploadedFile[]) => {
   // Limit to top 3 files for direct generation context to preserve payload size
   return files.slice(0, 3).map(prepareFilePart).filter(p => p !== null);
};

export const applyMagicTool = async (text: string, tool: MagicToolType): Promise<string> => {
  const ai = getAI();
  let instruction = "";
  
  switch(tool) {
    case 'Expand': instruction = "Expand this text with more detailed explanations, examples, and academic nuance. Increase word count by ~30%."; break;
    case 'Condense': instruction = "Condense this text to be more concise and punchy without losing key technical meaning. Reduce word count by ~30%."; break;
    case 'FixGrammar': instruction = "Fix all grammar, punctuation, and stylistic errors. Ensure perfect native-level academic English."; break;
    case 'MakeRigorous': instruction = "Inject more mathematical formalism. Convert descriptive logic into LaTeX equations where possible. Use more precise terminology."; break;
  }

  const prompt = `
    Task: Apply the following transformation to the text: "${instruction}"
    
    Text:
    ${text}
  `;

  try {
    const response = await callWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    }));
    return response.text || text;
  } catch (error) {
    return text;
  }
};

export const consultCPO = async (
  query: string, 
  history: ChatMessage[],
  context: { title: string; gap: string; novelty: string }
): Promise<string> => {
  const ai = getAI();
  
  const systemContext = `
    You are the Chief Publication Officer (CPO) assisting an author.
    Current Paper Context:
    Title: ${context.title}
    Gap: ${context.gap}
    Novelty: ${context.novelty}
    
    Answer the user's question about their paper. Be critical, helpful, and strategic (Q1 focus).
  `;

  const conversation = history.slice(-10).map(h => `${h.role}: ${h.text}`).join('\n'); // Limit history

  try {
    // Try Pro for chat
    const response = await callWithRetry(() => ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `${systemContext}\n\nPrevious Chat:\n${conversation}\n\nUser: ${query}`
    }));
    return response.text || "I cannot answer that right now.";
  } catch (error: any) {
    // Fallback to Flash
     try {
        const response = await callWithRetry(() => ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `${systemContext}\n\nPrevious Chat:\n${conversation}\n\nUser: ${query}`
        }));
        return response.text || "I cannot answer that right now.";
     } catch (e) {
        return "The CPO is currently unavailable (Quota Exceeded).";
     }
  }
};

export const humanizeText = async (text: string, level: HumanizeLevel): Promise<string> => {
  return applyMagicTool(text, 'FixGrammar');
};