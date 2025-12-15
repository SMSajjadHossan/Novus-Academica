import React, { useState, useEffect, useRef } from 'react';
import { Layout } from './components/Layout';
import { SectionEditor } from './components/SectionEditor';
import { ResearchState, PaperSectionType, UploadedFile, ChatMessage } from './types';
import { analyzeFilesForNovelty, generateSectionContent, consultCPO } from './services/geminiService';

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

// Helper to format file size
const formatBytes = (bytes: number, decimals = 1) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

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
    extractedReferences: [],
    chatHistory: [],
    isChatOpen: false,
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
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!process.env.API_KEY) setApiKeyMissing(true);
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try { 
        const parsed = JSON.parse(saved);
        // We might not have saved files to avoid quota limits, so we keep existing files if any, or empty
        setState(prev => ({ ...parsed, files: parsed.files || [] })); 
      } catch (e) { console.error("Auto-load failed"); }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (state.paperTitle || state.chatHistory.length > 0) saveProject(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.chatHistory, state.isChatOpen]);

  const readFileAsData = (file: File): Promise<UploadedFile> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          name: file.name,
          type: file.type || 'application/octet-stream',
          data: reader.result as string
        });
      };
      reader.onerror = reject;
      
      // Smart reading: Text for text files (smaller), Base64 for PDF/Images
      if (file.type.includes('pdf') || file.type.includes('image')) {
        reader.readAsDataURL(file);
      } else {
        // Read as DataURL for consistency in current backend, but we could optimize to readAsText
        // The service currently expects base64 for everything or handles it.
        // Let's stick to DataURL for maximum compatibility with the current service layer
        // which expects a base64 string or parses it.
        reader.readAsDataURL(file);
      }
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    if (!e.target.files || e.target.files.length === 0) return;

    const selectedFiles = Array.from(e.target.files);
    const validFiles = selectedFiles.filter((file: File) => {
      const name = file.name.toLowerCase();
      // Expanded support
      return name.endsWith('.pdf') || 
             name.endsWith('.txt') || 
             name.endsWith('.md') || 
             name.endsWith('.tex') || 
             name.endsWith('.latex') ||
             file.type.includes('text') ||
             file.type.includes('pdf');
    });

    if (validFiles.length === 0) {
      setErrorMsg("No supported files found. Please upload PDF, TXT, MD, or TEX.");
      return;
    }

    setAnalyzing(true); // Show a busy state briefly while reading
    try {
      const processedFiles = await Promise.all(validFiles.map(readFileAsData));
      setState(prev => ({
        ...prev,
        files: [...prev.files, ...processedFiles]
      }));
    } catch (err) {
      setErrorMsg("Failed to read files. Please try again.");
    } finally {
      setAnalyzing(false);
      // Reset input so same files can be selected again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeFile = (index: number) => {
    setState(prev => ({
      ...prev,
      files: prev.files.filter((_, i) => i !== index)
    }));
  };

  const saveProject = (silent = false) => {
    try {
      // SMART SAVE: If files are huge, don't save them to localStorage to avoid quota crash.
      // We calculate rough size.
      const stateString = JSON.stringify(state);
      if (stateString.length > 4500000) { // ~4.5MB safety limit
        // Create a lightweight version without file data
        const lightState = { ...state, files: [] };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(lightState));
        if (!silent) console.warn("Project saved (Files excluded due to size limits).");
      } else {
        localStorage.setItem(LOCAL_STORAGE_KEY, stateString);
      }
      setLastSaved(new Date());
      if (!silent) alert("Project saved!");
    } catch (e) {
      // If it still fails, try saving strictly content
      try {
        const minimalState = { ...state, files: [], chatHistory: state.chatHistory.slice(-5) };
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(minimalState));
      } catch (innerE) {
        if (!silent) alert("Storage Full: Could not auto-save.");
      }
    }
  };

  const startResearch = async () => {
    if (state.files.length === 0) return alert("Upload files first.");
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const result = await analyzeFilesForNovelty(state.files);
      setState(prev => {
        const updatedSections = prev.sections.map(s => s.type === PaperSectionType.Title ? { ...s, content: `# ${result.title}` } : s);
        return {
          ...prev,
          paperTitle: result.title,
          researchGap: result.gap,
          noveltyClaim: result.novelty,
          targetJournal: result.target_journal,
          methodologyPlan: result.methodology_plan,
          expectedResults: result.expected_results,
          qualityChecklist: result.checklist,
          extractedReferences: result.references || [],
          sections: updatedSections,
          chatHistory: [...prev.chatHistory, { role: 'model', text: `I have analyzed ${state.files.length} documents. We are targeting ${result.target_journal}. I identified a gap in ${result.gap}. Shall we begin drafting?`, timestamp: Date.now() }],
          isChatOpen: true
        };
      });
    } catch (err: any) { setErrorMsg(`Analysis failed: ${err.message}`); } finally { setAnalyzing(false); }
  };

  const handleGenerateSection = async (sectionId: string) => {
    if (!state.noveltyClaim) return alert("Run Analysis first.");
    setState(prev => ({ ...prev, sections: prev.sections.map(s => s.id === sectionId ? { ...s, isGenerating: true } : s) }));
    const section = state.sections.find(s => s.id === sectionId);
    if (!section) return;
    const content = await generateSectionContent(section.type, {
      files: state.files, title: state.paperTitle, gap: state.researchGap, novelty: state.noveltyClaim,
      targetJournal: state.targetJournal, methodologyPlan: state.methodologyPlan,
      otherSections: state.sections.filter(s => s.id !== sectionId && s.content.length > 0)
    });
    setState(prev => ({ ...prev, sections: prev.sections.map(s => s.id === sectionId ? { ...s, isGenerating: false, content } : s) }));
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { role: 'user', text: chatInput, timestamp: Date.now() };
    setState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, userMsg] }));
    setChatInput("");
    setIsChatting(true);
    
    const replyText = await consultCPO(userMsg.text, state.chatHistory, { title: state.paperTitle, gap: state.researchGap, novelty: state.noveltyClaim });
    
    setIsChatting(false);
    setState(prev => ({ ...prev, chatHistory: [...prev.chatHistory, { role: 'model', text: replyText, timestamp: Date.now() }] }));
  };

  const SidebarContent = (
    <div className="px-4 py-2 space-y-6">
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex justify-between items-center">
          <span>Source Data Deck</span>
          <span className="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">{state.files.length} Files</span>
        </label>
        
        <div className="border-2 border-dashed border-slate-700 rounded-lg p-6 hover:border-teal-500 transition-all cursor-pointer relative group bg-slate-900/50 flex flex-col items-center justify-center gap-2">
          <input 
            ref={fileInputRef}
            type="file" 
            multiple 
            accept=".pdf,.txt,.md,.tex,.latex" 
            onChange={handleFileUpload} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
          />
          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
            <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          </div>
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Drop PDF / TXT / MD</p>
        </div>

        {state.files.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
            {state.files.map((f, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-slate-300 bg-slate-900 p-2.5 rounded border border-slate-800 hover:border-slate-600 transition-colors group">
                 <div className="flex items-center gap-2 overflow-hidden">
                    <span className="text-slate-500">
                      {f.name.endsWith('.pdf') ? '📕' : '📄'}
                    </span>
                    <span className="truncate font-mono text-[11px]">{f.name}</span>
                 </div>
                 <div className="flex items-center gap-2">
                   <span className="text-[9px] text-slate-600">{formatBytes(f.data.length * 0.75)}</span>
                   <button 
                     onClick={() => removeFile(i)}
                     className="text-slate-600 hover:text-red-400 transition-colors p-1"
                     title="Remove file"
                   >
                     ✕
                   </button>
                 </div>
              </div>
            ))}
            <div className="text-center pt-2">
               <button 
                 onClick={() => setState(prev => ({ ...prev, files: [] }))}
                 className="text-[10px] text-red-500/70 hover:text-red-400 underline decoration-red-900/50"
               >
                 Clear All Sources
               </button>
            </div>
          </div>
        )}
      </div>

      <button onClick={startResearch} disabled={analyzing || state.files.length === 0} className={`w-full py-4 px-4 rounded text-xs font-bold tracking-wide uppercase transition-all shadow-xl ${state.files.length > 0 ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transform hover:-translate-y-0.5' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>
        {analyzing ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Analyzing Deck...
          </span>
        ) : 'Initialize CPO Protocol'}
      </button>

      {state.extractedReferences.length > 0 && (
        <div className="space-y-2 pt-4 border-t border-slate-800">
           <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
             <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
             Detected Sources
           </label>
           <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
             {state.extractedReferences.map((ref, i) => (
               <div key={i} className="text-[10px] text-slate-400 p-1.5 bg-slate-900/50 rounded border border-slate-800/50 truncate hover:text-slate-200 transition-colors">{ref}</div>
             ))}
           </div>
        </div>
      )}

      <div className="space-y-1 pt-4 border-t border-slate-800">
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">Manuscript Map</label>
        {state.sections.map(section => (
          <button key={section.id} onClick={() => { document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: 'smooth' }); setState(prev => ({ ...prev, activeSectionId: section.id })); }} className={`w-full text-left px-3 py-2 rounded text-xs transition-all flex items-center justify-between border-l-2 ${state.activeSectionId === section.id ? 'bg-slate-800 text-teal-400 border-teal-500 shadow-md' : 'border-transparent text-slate-400 hover:bg-slate-900'}`}>
            <span>{section.type}</span>
            {section.content && <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shadow-[0_0_5px_rgba(20,184,166,0.6)]"></span>}
          </button>
        ))}
      </div>
      
      {lastSaved && <div className="text-[9px] text-center text-slate-700 pt-4">Auto-save active • {lastSaved.toLocaleTimeString()}</div>}
    </div>
  );

  if (apiKeyMissing) return (
    <div className="flex h-screen items-center justify-center bg-slate-950 text-white p-6 relative overflow-hidden">
       <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950"></div>
       <div className="relative z-10 max-w-md text-center p-8 border border-red-900/50 bg-slate-900/50 backdrop-blur-xl rounded-2xl shadow-2xl">
          <h2 className="text-3xl font-bold mb-4 text-red-500 font-serif">System Halted</h2>
          <p className="text-slate-400 mb-6">Critical Configuration Missing: <code>API_KEY</code></p>
          <div className="bg-slate-950 p-4 rounded text-xs text-left font-mono text-slate-500">
             Please check your environment variables or metadata.json configuration.
          </div>
       </div>
    </div>
  );

  return (
    <Layout sidebar={SidebarContent}>
      <div className="relative">
        {errorMsg && (
          <div className="fixed top-4 right-4 z-50 bg-red-900/90 border border-red-700 text-white px-6 py-4 rounded-lg shadow-2xl backdrop-blur-md animate-bounce">
            <div className="font-bold mb-1">System Alert</div>
            <div className="text-sm">{errorMsg}</div>
            <button onClick={() => setErrorMsg(null)} className="absolute top-1 right-2 text-red-300 hover:text-white">×</button>
          </div>
        )}

        <div className="mb-12 space-y-8">
           {state.noveltyClaim ? (
              <div className="space-y-8 animate-fade-in-up">
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-700 p-10 shadow-2xl">
                   <div className="absolute top-0 right-0 p-4 opacity-5 text-9xl font-serif text-teal-500 select-none pointer-events-none">Q1</div>
                   <div className="relative z-10">
                        <div className="flex items-center gap-4 mb-6 flex-wrap">
                            <span className="bg-teal-500/10 text-teal-300 text-xs font-bold px-3 py-1.5 rounded-full border border-teal-500/20 uppercase tracking-widest shadow-[0_0_10px_rgba(20,184,166,0.2)]">Active Blueprint</span>
                            {state.targetJournal && <span className="bg-indigo-500/10 text-indigo-300 text-xs font-bold px-3 py-1.5 rounded-full border border-indigo-500/20 uppercase tracking-widest">Target: {state.targetJournal}</span>}
                        </div>
                       <h1 className="text-4xl font-serif text-slate-100 mb-8 leading-tight max-w-5xl tracking-tight">{state.paperTitle}</h1>
                       <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-sm">
                          <div className="bg-slate-950/50 p-6 rounded-xl border border-indigo-500/20 hover:border-indigo-500/40 transition-colors">
                             <span className="text-indigo-400 font-bold uppercase text-xs tracking-wide block mb-3">Strategic Gap</span>
                             <p className="text-slate-300 leading-relaxed font-serif mb-4"><strong className="text-indigo-300">Gap:</strong> {state.researchGap}</p>
                             <p className="text-slate-300 leading-relaxed font-serif"><strong className="text-indigo-300">Novelty:</strong> {state.noveltyClaim}</p>
                          </div>
                          <div className="bg-slate-950/50 p-6 rounded-xl border border-teal-500/20 hover:border-teal-500/40 transition-colors">
                             <span className="text-teal-400 font-bold uppercase text-xs tracking-wide block mb-3">Technical Execution</span>
                             <p className="text-slate-300 leading-relaxed font-serif mb-4">{state.methodologyPlan}</p>
                             {state.expectedResults && <div className="text-xs text-teal-500/80 mt-2 border-t border-teal-500/10 pt-3"><strong className="text-teal-400">Key Claims:</strong> {state.expectedResults}</div>}
                          </div>
                       </div>
                   </div>
                </div>
                {state.qualityChecklist && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                     {Object.entries(state.qualityChecklist).map(([key, val]) => (
                       <div key={key} className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl hover:bg-slate-800/50 transition-colors group">
                          <h4 className="text-teal-500/70 group-hover:text-teal-400 text-[10px] font-bold uppercase mb-2 tracking-widest">{key.replace('_check','')}</h4>
                          <p className="text-slate-400 group-hover:text-slate-300 text-xs leading-relaxed">{val}</p>
                       </div>
                     ))}
                  </div>
                )}
              </div>
           ) : (
              <div className="text-center py-32 bg-slate-900/30 rounded-3xl border border-dashed border-slate-800 flex flex-col items-center justify-center group hover:border-slate-700 transition-all">
                 <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-6 shadow-2xl group-hover:scale-105 transition-transform">
                    <svg className="w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                 </div>
                 <h3 className="text-3xl font-serif text-slate-200 mb-3 tracking-tight">Novus Academica</h3>
                 <p className="text-slate-500 max-w-lg mx-auto mb-8 leading-relaxed">
                   Upload your raw research materials (PDF, TXT, LaTeX) to the deck. 
                   The <span className="text-indigo-400 font-medium">Neural CPO</span> will analyze them for Q1 impact gaps.
                 </p>
              </div>
           )}
        </div>
        
        <div className="space-y-20 pb-48">
          {state.sections.map(section => (
            <div key={section.id} id={`section-${section.id}`} className="scroll-mt-6">
              <SectionEditor section={section} onUpdate={(id, c) => setState(p => ({...p, sections: p.sections.map(s => s.id === id ? {...s, content: c} : s)}))} onGenerate={handleGenerateSection} />
            </div>
          ))}
        </div>
        
        {/* NEURAL CONSULTANT CHAT OVERLAY */}
        <div className={`fixed bottom-0 right-8 w-96 bg-slate-950 border border-slate-700 rounded-t-xl shadow-2xl transition-transform duration-300 z-50 flex flex-col ${state.isChatOpen ? 'translate-y-0 h-[650px]' : 'translate-y-[600px] h-[650px] hover:translate-y-[590px]'}`}>
          <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/80 backdrop-blur rounded-t-xl cursor-pointer hover:bg-slate-900 transition-colors" onClick={() => setState(p => ({...p, isChatOpen: !p.isChatOpen}))}>
             <div className="flex items-center gap-3">
               <div className="relative">
                 <div className={`w-2.5 h-2.5 rounded-full ${state.noveltyClaim ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></div>
                 {state.noveltyClaim && <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75"></div>}
               </div>
               <div>
                  <div className="font-bold text-sm text-slate-100">Neural CPO</div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Consultant Active</div>
               </div>
             </div>
             <button className="text-slate-400 hover:text-white p-2">{state.isChatOpen ? '▼' : '▲'}</button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-slate-950/95 custom-scrollbar">
             {state.chatHistory.length === 0 && (
               <div className="text-center text-slate-600 text-xs py-10">
                 Ask questions about your manuscript strategy, reviewer objections, or statistical methods.
               </div>
             )}
             {state.chatHistory.map((msg, idx) => (
               <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'}`}>
                    {msg.text}
                  </div>
               </div>
             ))}
             {isChatting && (
               <div className="flex justify-start">
                 <div className="bg-slate-800 rounded-2xl rounded-bl-none p-4 border border-slate-700 flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-100"></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-200"></span>
                 </div>
               </div>
             )}
             <div ref={chatEndRef}></div>
          </div>
          
          <form onSubmit={handleChatSubmit} className="p-4 border-t border-slate-800 bg-slate-900/90 backdrop-blur rounded-b-none">
             <div className="relative group">
               <input 
                 type="text" 
                 value={chatInput} 
                 onChange={e => setChatInput(e.target.value)} 
                 placeholder="Ask the CPO..." 
                 className="w-full bg-slate-950 border border-slate-700 rounded-lg py-3 px-4 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all pr-12 placeholder-slate-600"
               />
               <button 
                 type="submit" 
                 disabled={!chatInput.trim() || isChatting} 
                 className="absolute right-2 top-2 p-1.5 rounded-md text-indigo-500 hover:bg-indigo-500/10 hover:text-indigo-400 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
               >
                 <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
               </button>
             </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}