import React from 'react';

export function Gauge({ value, label }: { value: number, label: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (value / 100) * circumference;
  
  let color = '#22c55e'; // green
  if (value < 50) color = '#ef4444'; // red
  else if (value < 80) color = '#F27D26'; // orange

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="relative w-32 h-32 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90">
          <circle cx="64" cy="64" r={radius} stroke="#2A2A2C" strokeWidth="8" fill="transparent" />
          <circle 
            cx="64" cy="64" r={radius} 
            stroke={color} 
            strokeWidth="8" 
            fill="transparent" 
            strokeDasharray={circumference} 
            strokeDashoffset={strokeDashoffset} 
            className="transition-all duration-1000 ease-out" 
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <span className="text-3xl font-mono font-bold text-strong">{value}</span>
        </div>
      </div>
      <div className="mt-2 text-[10px] uppercase font-bold tracking-widest text-muted">{label}</div>
    </div>
  );
}
