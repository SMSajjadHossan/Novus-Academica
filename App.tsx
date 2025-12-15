import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from './components/Layout';
import { SectionEditor } from './components/SectionEditor';
import { ResearchState, PaperSectionType, PaperSection, UploadedFile } from './types';
import { analyzeFilesForNovelty, generateSectionContent } from './services/geminiService';

const INITIAL_SECTIONS: PaperSectionType[] = [
  PaperSectionType.Title,
  PaperSectionType.Abstract,
  PaperSectionType.Introduction,
  PaperSectionType.LiteratureReview,
  PaperSectionType.Methodology,
  PaperSectionType.Results,
  PaperSectionType.Discussion,
  PaperSectionType.Conclusion,
  PaperSectionType.References
];

const LOCAL_STORAGE_KEY = 'novus_academica_state';

export default function App() {
  const [state, setState] = useState<ResearchState>({
    files: [],
    paperTitle: '',
    researchGap: '',
    noveltyClaim: '',
    targetJournal: '',
    methodologyPlan: '',
    expectedResults: '',
    qualityChecklist: null,
    sections: INITIAL_SECTIONS.map(type => ({
      id: type,
      type,
      title: type,
      content: '',
      isGenerating: false,
      notes: ''
    })),
    activeSectionId: PaperSectionType.Introduction
  });

  const [analyzing, setAnalyzing] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Initial Load
  useEffect(() => {
    if (!process.env.API_KEY) {
      setApiKeyMissing(true);
    }
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState(parsed);
      } catch (e) { console.error("Auto-load failed"); }
    }
  }, []);

  // Auto-Save Effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (state.files.length > 0 || state.paperTitle) {
        saveProject(true);
      }
    }, 5000); // Debounce 5s

    return () => clearTimeout(timer);
  }, [state]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    if (e.target.files && e.target.files.length > 0) {
      const newFiles: UploadedFile[] = [];
      Array.from(e.target.files).forEach((file: File) => {
        if (file.type !== 'application/pdf' && file.type !== 'text/plain' && !file.name.endsWith('.txt')) {
           alert(`File ${file.name} is skipped. Only PDF and TXT files are supported currently.`);
           return;
        }

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
          const result = loadEvent.target?.result as string;
          if (result) {
            newFiles.push({
              name: file.name,
              type: file.type || 'application/octet-stream', 
              data: result
            });
            setState(prev => ({ ...prev, files: [...prev.files, ...newFiles] }));
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const saveProject = (silent = false) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
      setLastSaved(new Date());
      if (!silent) alert("Project saved successfully!");
    } catch (e: any) {
      if (
        e.name === 'QuotaExceededError' ||
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        e.code === 22
      ) {
        if (!silent && confirm("Storage limit exceeded (files are too large). Save text content only?")) {
          const textOnlyState = {
            ...state,
            files: state.files.map(f => ({ ...f, data: '' }))
          };
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(textOnlyState));
          setLastSaved(new Date());
        }
      } else if (!silent) {
        alert("Failed to save project: " + e.message);
      }
    }
  };

  const exportPaper = () => {
    const header = `# ${state.paperTitle}\n\n`;
    const meta = `**Target Journal:** ${state.targetJournal}\n\n`;
    const body = state.sections.map(s => `${s.content}\n\n`).join('');
    const fullText = header + meta + body;
    
    const blob = new Blob([fullText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'draft_manuscript.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const startResearch = async () => {
    if (state.files.length === 0) return alert("Please upload research materials (PDF/TXT) first.");
    const hasData = state.files.every(f => f.data && f.data.length > 0);
    if (!hasData) return alert("File data is missing. Please re-upload source files.");

    setAnalyzing(true);
    setErrorMsg(null);
    
    try {
      const analysis = await analyzeFilesForNovelty(state.files);
      setState(prev => {
        const updatedSections = prev.sections.map(s => 
            s.type === PaperSectionType.Title 
            ? { ...s, content: `# ${analysis.title}` } 
            : s
        );

        return {
          ...prev,
          paperTitle: analysis.title,
          researchGap: analysis.gap,
          noveltyClaim: analysis.novelty,
          targetJournal: analysis.target_journal,
          methodologyPlan: analysis.methodology_plan,
          expectedResults: analysis.expected_results,
          qualityChecklist: analysis.checklist,
          sections: updatedSections
        };
      });
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Analysis failed: ${err.message || "Unknown error."}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateSection = async (sectionId: string) => {
    if (!state.noveltyClaim) return alert("Run 'Deep Analysis' first.");
    const hasData = state.files.every(f => f.data && f.data.length > 0);
    if (!hasData) return alert("File data is missing. Re-upload files.");

    setState(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === sectionId ? { ...s, isGenerating: true } : s)
    }));

    const section = state.sections.find(s => s.id === sectionId);
    if (!section) return;

    const otherSections = state.sections
      .filter(s => s.id !== sectionId && s.content.length > 0)
      .map(s => ({ type: s.type, content: s.content }));

    const content = await generateSectionContent(section.type, {
      files: state.files,
      title: state.paperTitle,
      gap: state.researchGap,
      novelty: state.noveltyClaim,
      targetJournal: state.targetJournal,
      methodologyPlan: state.methodologyPlan,
      expectedResults: state.expectedResults,
      otherSections
    });

    setState(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === sectionId ? { ...s, isGenerating: false, content } : s)
    }));
  };

  const handleUpdateSection = (sectionId: string, newContent: string) => {
    setState(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === sectionId ? { ...s, content: newContent } : s)
    }));
  };

  const SidebarContent = (
    <div className="px-4 py-2 space-y-6">
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex justify-between">
            <span>Resources</span>
            {lastSaved && <span className="text-teal-500/80 font-normal normal-case">Saved {lastSaved.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>}
        </label>
        <div className="border-2 border-dashed border-slate-700 rounded-lg p-4 hover:border-teal-500 transition-all cursor-pointer relative group bg-slate-900/50">
          <input 
            type="file" 
            multiple 
            accept=".pdf,.txt" 
            onChange={handleFileUpload} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div className="text-center group-hover:scale-105 transition-transform">
            <svg className="w-8 h-8 mx-auto text-slate-500 group-hover:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-xs text-slate-400 mt-2 font-medium">Drop PDF/TXT Research</p>
          </div>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar">
          {state.files.map((f, i) => (
            <div key={i} className="flex items-center text-xs text-slate-300 bg-slate-900 p-2 rounded border border-slate-800">
               <span className="truncate flex-1 font-mono">{f.name}</span>
               {(!f.data || f.data.length === 0) && <span className="text-amber-500 text-[10px] ml-1" title="Data missing">⚠️</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <button 
          onClick={startResearch}
          disabled={analyzing || state.files.length === 0}
          className={`w-full py-3 px-4 rounded text-sm font-bold tracking-wide transition-all flex justify-center items-center ${
            state.files.length > 0
            ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-900/50'
            : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          {analyzing ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                CPO Analyzing...
              </>
          ) : '1. Run Q1 Analysis'}
        </button>

        <div className="grid grid-cols-2 gap-2">
            <button 
                onClick={exportPaper}
                disabled={!state.paperTitle}
                className="col-span-2 py-2 px-3 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-teal-400 border border-slate-700 transition-colors flex items-center justify-center gap-2"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export Manuscript
            </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-900/50 border border-red-800 text-red-200 p-3 rounded text-xs break-words">
          {errorMsg}
        </div>
      )}

      <nav className="space-y-1">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Blueprint</label>
        {state.sections.map(section => (
          <button
            key={section.id}
            onClick={() => {
              const el = document.getElementById(`section-${section.id}`);
              el?.scrollIntoView({ behavior: 'smooth' });
              setState(prev => ({ ...prev, activeSectionId: section.id }));
            }}
            className={`w-full text-left px-3 py-2 rounded text-sm transition-all flex items-center justify-between group border-l-2 ${
              state.activeSectionId === section.id 
                ? 'bg-slate-800 text-teal-400 border-teal-500 shadow-md' 
                : 'border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            <span>{section.type}</span>
            {section.content && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.5)]"></span>}
          </button>
        ))}
      </nav>
    </div>
  );

  if (apiKeyMissing) {
     return (
        <div className="flex h-screen items-center justify-center bg-slate-950 text-white p-6">
           <div className="max-w-md text-center">
              <h2 className="text-2xl font-bold mb-4 text-red-500">Configuration Error</h2>
              <p>The <code>API_KEY</code> environment variable is missing.</p>
           </div>
        </div>
     )
  }

  return (
    <Layout sidebar={SidebarContent}>
      <div className="mb-10 space-y-6">
         {state.noveltyClaim ? (
            <div className="space-y-6">
              {/* Main Analysis Card */}
              <div className="relative group overflow-hidden rounded-xl bg-slate-900 border border-slate-700 p-8 shadow-2xl">
                 <div className="absolute top-0 right-0 p-4 opacity-5 text-9xl font-serif text-teal-500 select-none">Q1</div>
                 <div className="relative z-10">
                      <div className="flex items-center gap-4 mb-4 flex-wrap">
                          <span className="bg-teal-900/50 text-teal-300 text-xs font-bold px-2 py-1 rounded border border-teal-800 uppercase tracking-widest">Q1 Blueprint Ready</span>
                          {state.targetJournal && (
                              <span className="bg-indigo-900/50 text-indigo-300 text-xs font-bold px-2 py-1 rounded border border-indigo-800 uppercase tracking-widest flex items-center">
                                  <span className="mr-1">Venue:</span> {state.targetJournal}
                              </span>
                          )}
                      </div>
                     <h1 className="text-3xl font-serif text-slate-100 mb-6 leading-tight max-w-4xl">{state.paperTitle}</h1>
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                        <div className="bg-slate-950/80 p-5 rounded-lg border border-indigo-900/30">
                           <span className="text-indigo-400 font-bold uppercase text-xs tracking-wide block mb-2">Research Gap & Contribution</span>
                           <p className="text-slate-300 leading-relaxed font-serif mb-3"><strong className="text-indigo-300">SOTA Weakness:</strong> {state.researchGap}</p>
                           <p className="text-slate-300 leading-relaxed font-serif"><strong className="text-indigo-300">Novelty:</strong> {state.noveltyClaim}</p>
                        </div>
                        <div className="bg-slate-950/80 p-5 rounded-lg border border-teal-900/30">
                           <span className="text-teal-400 font-bold uppercase text-xs tracking-wide block mb-2">Methodology & Experiments</span>
                           <p className="text-slate-300 leading-relaxed font-serif mb-3">{state.methodologyPlan}</p>
                           {state.expectedResults && <p className="text-xs text-teal-500/80 mt-2 border-t border-teal-900/30 pt-2"><strong className="text-teal-400">Claims:</strong> {state.expectedResults}</p>}
                        </div>
                     </div>
                 </div>
              </div>

              {/* Quality Checklist */}
              {state.qualityChecklist && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                   <div className="bg-emerald-900/20 border border-emerald-900/40 p-3 rounded-lg">
                      <h4 className="text-emerald-400 text-xs font-bold uppercase mb-1">Novelty Check</h4>
                      <p className="text-emerald-100/70 text-xs">{state.qualityChecklist.novelty_check}</p>
                   </div>
                   <div className="bg-blue-900/20 border border-blue-900/40 p-3 rounded-lg">
                      <h4 className="text-blue-400 text-xs font-bold uppercase mb-1">Impact Check</h4>
                      <p className="text-blue-100/70 text-xs">{state.qualityChecklist.significance_check}</p>
                   </div>
                   <div className="bg-purple-900/20 border border-purple-900/40 p-3 rounded-lg">
                      <h4 className="text-purple-400 text-xs font-bold uppercase mb-1">Clarity Check</h4>
                      <p className="text-purple-100/70 text-xs">{state.qualityChecklist.clarity_check}</p>
                   </div>
                   <div className="bg-amber-900/20 border border-amber-900/40 p-3 rounded-lg">
                      <h4 className="text-amber-400 text-xs font-bold uppercase mb-1">Fit Check</h4>
                      <p className="text-amber-100/70 text-xs">{state.qualityChecklist.journal_fit_check}</p>
                   </div>
                </div>
              )}
            </div>
         ) : (
            <div className="text-center py-24 bg-gradient-to-b from-slate-900 to-slate-950 rounded-2xl border border-dashed border-slate-800 flex flex-col items-center justify-center">
               <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mb-6 shadow-inner text-slate-600">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
               </div>
               <h3 className="text-2xl font-serif font-medium text-slate-200 mb-2">Chief Publication Officer (CPO)</h3>
               <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
                 Upload your raw research materials. I will act as your CPO to identify <span className="text-indigo-400 font-medium">Q1 gaps</span>, enforce <span className="text-indigo-400 font-medium">Writing Order 2A</span>, and generate a <span className="text-indigo-400 font-medium">submission-ready</span> manuscript.
               </p>
            </div>
         )}
      </div>

      <div className="space-y-16 pb-32">
        {state.sections.map(section => (
          <div key={section.id} id={`section-${section.id}`} className="scroll-mt-6">
            <SectionEditor 
              section={section}
              onUpdate={handleUpdateSection}
              onGenerate={handleGenerateSection}
            />
          </div>
        ))}
      </div>
    </Layout>
  );
}