'use client';

import React from 'react';

interface FretboardProps {
  highlightedFret?: { string: number; fret: number } | null;
  activeNote?: { string: number; fret: number } | null;
  masteryData?: Record<string, number>;
  showHeatmap?: boolean;
  fretRange?: [number, number];
}

export const Fretboard: React.FC<FretboardProps> = ({
  highlightedFret,
  activeNote,
  masteryData = {},
  showHeatmap = false,
  fretRange = [0, 12],
}) => {
  const strings = [1, 2, 3, 4, 5, 6];
  const [startFret, endFret] = fretRange;
  const numFrets = endFret - startFret;

  // Visual constants - Compact version
  const width = 800;
  const height = 130; 
  const marginX = 25; // Extra padding for open string indicators
  const marginY = 15;
  const neckWidth = width - marginX * 2;
  const neckHeight = height - marginY * 2;
  const stringSpacing = neckHeight / 5;
  const fretSpacing = neckWidth / numFrets;

  const getMasteryColor = (string: number, fret: number) => {
    const key = `${string}-${fret}`;
    const score = masteryData[key] || 0;
    // Score 0 (Red) -> 1 (Green)
    const red = Math.floor(255 * Math.pow(1 - score, 2)); // Use power for more dramatic curve
    const green = Math.floor(255 * Math.pow(score, 1/2));
    return `rgb(${red}, ${green}, 50)`;
  };

  return (
    <div className="w-full">
      <svg 
        viewBox={`0 0 ${width} ${height}`} 
        className="w-full h-auto min-w-[700px] lg:min-w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={marginX} y={marginY} width={neckWidth} height={neckHeight} fill="#111" rx="2" />
        <rect x={marginX - 3} y={marginY - 1} width="6" height={neckHeight + 2} fill="#e5e7eb" rx="1" />

        {Array.from({ length: numFrets + 1 }).map((_, i) => (
          <g key={`fret-${i}`}>
            <line x1={marginX + i * fretSpacing + 0.5} y1={marginY} x2={marginX + i * fretSpacing + 0.5} y2={height - marginY} stroke="#000" strokeWidth="1" opacity="0.6" />
            <line x1={marginX + i * fretSpacing} y1={marginY} x2={marginX + i * fretSpacing} y2={height - marginY} stroke="#cbd5e1" strokeWidth={i === 0 ? "0" : "1.5"} />
          </g>
        ))}

        {[3, 5, 7, 9, 12, 15, 17, 19, 21].map(fret => {
          if (fret < startFret || fret > endFret) return null;
          const x = marginX + (fret - startFret - 0.5) * fretSpacing;
          if (fret === 12) {
             return (
               <g key="marker-12">
                 <circle cx={x} cy={marginY + stringSpacing * 1.5} r="3" fill="#f8fafc" opacity="0.4" />
                 <circle cx={x} cy={marginY + stringSpacing * 3.5} r="3" fill="#f8fafc" opacity="0.4" />
               </g>
             );
          }
          return <circle key={`marker-${fret}`} cx={x} cy={height / 2} r="3" fill="#f8fafc" opacity="0.4" />;
        })}

        {strings.map((str, i) => (
          <g key={`string-${str}`}>
             <line x1={marginX} y1={marginY + i * stringSpacing + 0.5} x2={width - marginX} y2={marginY + i * stringSpacing + 0.5} stroke="#000" strokeWidth={0.8 + (6 - str) * 0.2} opacity="0.5" />
             <line x1={marginX} y1={marginY + i * stringSpacing} x2={width - marginX} y2={marginY + i * stringSpacing} stroke={str > 3 ? "#94a3b8" : "#f1f5f9"} strokeWidth={0.8 + (6 - str) * 0.2} opacity="0.8" />
          </g>
        ))}

        {/* Heatmap for Open Strings (Fret 0) */}
        {showHeatmap && startFret === 0 && strings.map(str => (
          <circle key={`heat-open-${str}`} cx={marginX - 12} cy={marginY + (str - 1) * stringSpacing} r="5" fill={getMasteryColor(str, 0)} fillOpacity="0.8" />
        ))}

        {showHeatmap && Array.from({ length: numFrets }).map((_, f) => {
          const fretNum = startFret + f + 1;
          return strings.map(str => (
            <rect key={`heat-${str}-${fretNum}`} x={marginX + f * fretSpacing + 1} y={marginY + (str - 1) * stringSpacing - stringSpacing / 2 + 1} width={fretSpacing - 2} height={stringSpacing - 2} fill={getMasteryColor(str, fretNum)} fillOpacity="0.3" rx="1" />
          ));
        })}

        {highlightedFret && highlightedFret.fret >= startFret && highlightedFret.fret <= endFret && (
          <circle 
            cx={highlightedFret.fret === 0 ? marginX - 12 : marginX + (highlightedFret.fret - startFret - 0.5) * fretSpacing} 
            cy={marginY + (highlightedFret.string - 1) * stringSpacing} 
            r="10" 
            fill="transparent" 
            stroke="#6366f1" 
            strokeWidth="2" 
            className="animate-pulse" 
          />
        )}

        {activeNote && activeNote.fret >= startFret && activeNote.fret <= endFret && (
          <g>
            <circle 
              cx={activeNote.fret === 0 ? marginX - 12 : marginX + (activeNote.fret - startFret - 0.5) * fretSpacing} 
              cy={marginY + (activeNote.string - 1) * stringSpacing} 
              r="8" 
              fill={highlightedFret?.string === activeNote.string && highlightedFret?.fret === activeNote.fret ? "#10b981" : "#ef4444"} 
            />
            <text 
              x={activeNote.fret === 0 ? marginX - 12 : marginX + (activeNote.fret - startFret - 0.5) * fretSpacing} 
              y={marginY + (activeNote.string - 1) * stringSpacing + 3} 
              textAnchor="middle" 
              fontSize="8" 
              fontWeight="bold" 
              fill="white"
            >
              ✓
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};
