import React, { useState, useEffect, useRef } from 'react';
import { PaperSection, HumanizeLevel } from '../types';
import { humanizeText } from '../services/geminiService';
import { marked } from 'marked';

interface SectionEditorProps {
  section: PaperSection;
  onUpdate: (id: string, newContent: string) => void;
  onGenerate: (id: string) => void;
}

export const SectionEditor: React.FC<SectionEditorProps> = ({ section, onUpdate, onGenerate }) => {
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [humanizeLevel, setHumanizeLevel] = useState<HumanizeLevel>('Academic-Flow');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current && mode === 'edit') {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [section.content, mode]);

  const handleHumanize = async () => {
    if (!section.content) return;
    setIsHumanizing(true);
    try {
      const newText = await humanizeText(section.content, humanizeLevel);
      onUpdate(section.id, newText);
    } catch (e) {
      alert("Failed to refine text.");
    } finally {
      setIsHumanizing(false);
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
    <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden mb-8 transition-all duration-300 hover:shadow-2xl hover:border-slate-600">
      <div className="bg-slate-800/50 p-4 border-b border-slate-700 flex flex-wrap gap-4 justify-between items-center backdrop-blur-sm sticky top-0 z-20">
        <div className="flex items-center space-x-4">
          <h2 className="text-lg font-serif font-semibold text-teal-50">{section.type}</h2>
          <div className="flex bg-slate-950 rounded p-1 border border-slate-700">
            <button
              onClick={() => setMode('edit')}
              className={`px-3 py-1 text-xs rounded transition-colors ${mode === 'edit' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Editor
            </button>
            <button
              onClick={() => setMode('preview')}
              className={`px-3 py-1 text-xs rounded transition-colors ${mode === 'preview' ? 'bg-teal-900/50 text-teal-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Preview
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {section.content && (
            <div className="flex items-center space-x-2 bg-slate-950 rounded-md p-1 border border-slate-700">
               <select 
                value={humanizeLevel}
                onChange={(e) => setHumanizeLevel(e.target.value as HumanizeLevel)}
                className="bg-transparent text-xs text-slate-400 outline-none border-none p-1 cursor-pointer hover:text-white"
               >
                 <option value="Standard">Standard</option>
                 <option value="Academic-Flow">Academic Flow</option>
                 <option value="High-Burstiness">Max Humanize</option>
               </select>
               <button
                onClick={handleHumanize}
                disabled={isHumanizing}
                className="text-xs bg-teal-700 hover:bg-teal-600 text-white px-3 py-1 rounded transition-colors disabled:opacity-50 flex items-center"
              >
                {isHumanizing && <span className="animate-spin mr-1">⟳</span>}
                {isHumanizing ? 'Refining...' : 'Humanize'}
              </button>
            </div>
          )}
          
          <button
            onClick={() => {
              setMode('edit');
              onGenerate(section.id);
            }}
            disabled={section.isGenerating}
            className={`text-xs px-4 py-2 rounded font-medium transition-all flex items-center ${
              section.isGenerating
                ? 'bg-amber-500/10 text-amber-500 cursor-wait border border-amber-500/20'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
            }`}
          >
            {section.isGenerating && <span className="animate-spin mr-2">⟳</span>}
            {section.isGenerating ? 'Drafting...' : section.content ? 'Regenerate' : 'Generate Draft'}
          </button>
        </div>
      </div>
      
      <div className="relative min-h-[300px] bg-slate-900">
        {section.isGenerating && (
          <div className="absolute inset-0 bg-slate-900/90 z-10 flex flex-col items-center justify-center backdrop-blur-sm">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-indigo-400 text-sm font-medium animate-pulse">Consulting context & writing draft...</p>
          </div>
        )}
        
        {mode === 'edit' ? (
          <textarea
            ref={textareaRef}
            value={section.content}
            onChange={(e) => onUpdate(section.id, e.target.value)}
            placeholder={`Content for ${section.type} will appear here. You can edit this text manually.`}
            className="w-full min-h-[500px] bg-slate-900 p-8 text-slate-300 font-serif leading-relaxed focus:outline-none focus:ring-1 focus:ring-teal-900/50 resize-none block"
            spellCheck={false}
          />
        ) : (
          <div 
            className="prose prose-invert max-w-none p-8 min-h-[500px] bg-slate-900/50"
            dangerouslySetInnerHTML={getMarkdownHtml()}
          />
        )}
      </div>
      
      <div className="bg-slate-950 p-2 px-4 flex justify-between items-center border-t border-slate-800">
         <span className="text-[10px] text-slate-600 uppercase tracking-widest">Markdown Supported</span>
         <span className="text-xs text-slate-500 font-mono">
           {section.content.split(/\s+/).filter(w => w.length > 0).length} words
         </span>
      </div>
    </div>
  );
};