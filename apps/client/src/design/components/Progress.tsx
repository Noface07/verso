import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ProgressBarProps {
  value: number; // 0 to 100
  className?: string;
  height?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ value, className, height = 3 }) => {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={twMerge('w-full bg-[var(--layer-3)] rounded-full overflow-hidden select-none', className)}
      style={{ height: `${height}px` }}
    >
      <div
        className="h-full bg-[var(--accent)] transition-all duration-[var(--d-fast)] ease-[var(--ease-out)]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};

export interface ProgressRingProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({
  size = 24,
  strokeWidth = 3,
  className,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      className={twMerge('animate-spin text-[var(--accent)] select-none shrink-0', className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="opacity-25"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      <circle
        className="opacity-90"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.75}
        strokeLinecap="round"
      />
    </svg>
  );
};

export interface CircularProgressProps {
  value: number; // 0 to 100+
  size?: number;
  strokeWidth?: number;
  className?: string;
  trackColor?: string;
  indicatorColor?: string;
  children?: React.ReactNode;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({
  value,
  size = 64,
  strokeWidth = 6,
  className,
  trackColor = 'var(--layer-3)',
  indicatorColor = 'var(--accent)',
  children,
}) => {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      className={twMerge('relative inline-flex items-center justify-center select-none shrink-0', className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={indicatorColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500 ease-out"
        />
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">{children}</div>}
    </div>
  );
};

export interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className }) => {
  return (
    <div
      className={twMerge(
        clsx(
          'animate-pulse bg-[var(--layer-2)] border border-[var(--stroke)] rounded-[var(--r-md)] select-none',
          className,
        ),
      )}
    />
  );
};
