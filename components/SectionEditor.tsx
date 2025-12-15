import React, { useState, useEffect, useRef } from 'react';
import { PaperSection, MagicToolType } from '../types';
import { applyMagicTool } from '../services/geminiService';
import { marked } from 'marked';

interface SectionEditorProps {
  section: PaperSection;
  onUpdate: (id: string, newContent: string) => void;
  onGenerate: (id: string) => void;
}

export const SectionEditor: React.FC<SectionEditorProps> = ({ section, onUpdate, onGenerate }) => {
  const [processingTool, setProcessingTool] = useState<MagicToolType | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current && mode === 'edit') {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [section.content, mode]);

  const handleMagicTool = async (tool: MagicToolType) => {
    if (!section.content) return;
    setProcessingTool(tool);
    try {
      const newText = await applyMagicTool(section.content, tool);
      onUpdate(section.id, newText);
    } catch (e) {
      alert("Tool failed.");
    } finally {
      setProcessingTool(null);
    }
  };

  const getMarkdownHtml = () => {
    try {
      return { __html: marked.parse(section.content) as string };
    } catch (e) {
      return { __html: '<p class="text-red-400">Error rendering preview.</p>' };
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden mb-8 transition-all duration-300 hover:shadow-2xl hover:border-slate-600 group">
      <div className="bg-slate-800/80 p-4 border-b border-slate-700 flex flex-wrap gap-4 justify-between items-center backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-serif font-semibold text-teal-50">{section.type}</h2>
          <div className="flex bg-slate-950 rounded p-1 border border-slate-700">
            <button onClick={() => setMode('edit')} className={`px-3 py-1 text-xs rounded transition-colors ${mode === 'edit' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Editor</button>
            <button onClick={() => setMode('preview')} className={`px-3 py-1 text-xs rounded transition-colors ${mode === 'preview' ? 'bg-teal-900/50 text-teal-400' : 'text-slate-400 hover:text-slate-200'}`}>Preview</button>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {section.content && mode === 'edit' && (
            <div className="flex items-center space-x-1 bg-slate-950 rounded-md p-1 border border-slate-700 mr-2">
               <span className="text-[10px] text-slate-500 px-2 uppercase tracking-wider font-bold">Magic Tools</span>
               <button onClick={() => handleMagicTool('Expand')} disabled={!!processingTool} title="Expand Text" className="p-1 hover:bg-slate-800 rounded text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
               </button>
               <button onClick={() => handleMagicTool('Condense')} disabled={!!processingTool} title="Condense Text" className="p-1 hover:bg-slate-800 rounded text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
               </button>
               <button onClick={() => handleMagicTool('MakeRigorous')} disabled={!!processingTool} title="Math Rigor (LaTeX)" className="p-1 hover:bg-slate-800 rounded text-rose-400 hover:text-rose-300 disabled:opacity-50">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
               </button>
               <button onClick={() => handleMagicTool('FixGrammar')} disabled={!!processingTool} title="Fix Grammar" className="p-1 hover:bg-slate-800 rounded text-amber-400 hover:text-amber-300 disabled:opacity-50">
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
               </button>
            </div>
          )}
          
          <button
            onClick={() => { setMode('edit'); onGenerate(section.id); }}
            disabled={section.isGenerating || !!processingTool}
            className={`text-xs px-4 py-2 rounded font-medium transition-all flex items-center shadow-lg ${
              section.isGenerating || !!processingTool
                ? 'bg-slate-800 text-slate-500 cursor-wait'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
            }`}
          >
            {(section.isGenerating || !!processingTool) && <span className="animate-spin mr-2">⟳</span>}
            {processingTool ? processingTool : (section.content ? 'Regenerate' : 'Generate Draft')}
          </button>
        </div>
      </div>
      
      <div className="relative min-h-[300px] bg-slate-900">
        {(section.isGenerating || processingTool) && (
          <div className="absolute inset-0 bg-slate-900/90 z-10 flex flex-col items-center justify-center backdrop-blur-sm">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-indigo-400 text-sm font-medium animate-pulse">
              {processingTool ? `Applying ${processingTool} logic...` : 'CPO Drafting Content...'}
            </p>
          </div>
        )}
        
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            value={section.content}
            onChange={(e) => onUpdate(section.id, e.target.value)}
            placeholder={`Content for ${section.type} will appear here.`}
            className="w-full min-h-[500px] bg-slate-900 p-8 text-slate-300 font-serif leading-relaxed focus:outline-none focus:ring-1 focus:ring-teal-900/50 resize-none block"
            spellCheck={false}
          />
        ) : (
          <div className="prose prose-invert max-w-none p-8 min-h-[500px] bg-slate-900/50" dangerouslySetInnerHTML={getMarkdownHtml()} />
        )}
      </div>
    </div>
  );
};