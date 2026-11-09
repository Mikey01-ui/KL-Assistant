import React, { useEffect, useState, useRef } from 'react';

// Custom hook for count-up animation
function useCountUp(targetValue, duration = 1500) {
  const [value, setValue] = useState(targetValue || 0);
  const prevTargetRef = useRef(targetValue || 0);
  const currentValueRef = useRef(targetValue || 0);

  useEffect(() => {
    if (targetValue === prevTargetRef.current) return;
    
    let startTime = null;
    let animationFrame;
    const startValue = currentValueRef.current;
    
    const animate = (currentTime) => {
      if (!startTime) startTime = currentTime;
      const progress = Math.min((currentTime - startTime) / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 4);
      const newValue = startValue + (targetValue - startValue) * easeProgress;
      
      currentValueRef.current = newValue;
      setValue(newValue);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    prevTargetRef.current = targetValue;

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [targetValue, duration]);

  return value;
}

const CircularGauge = React.memo(({ 
  value = 0, 
  max = 100, 
  size = 120, 
  strokeWidth = 8, 
  label = '', 
  subLabel = '', 
  color = 'var(--j-accent)' 
}) => {
  const animatedValue = useCountUp(value);
  
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const arcOffset = circumference * 0.25;
  const dashArray = `${circumference - arcOffset} ${arcOffset}`;
  
  const percentage = Math.min(Math.max(animatedValue / max, 0), 1);
  const strokeDashoffset = (circumference - arcOffset) * (1 - percentage);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg 
          width={size} 
          height={size} 
          viewBox={`0 0 ${size} ${size}`} 
          style={{ transform: 'rotate(135deg)' }}
        >
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--j-border)"
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            strokeLinecap="round"
          />
          
          {/* Fill */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={dashArray}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.1s linear' }}
          />
        </svg>

        {/* Center Text */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--j-font)',
        }}>
          <span style={{ 
            fontSize: `${size * 0.2}px`, 
            fontWeight: 700, 
            color: color,
          }}>
            {Math.round(animatedValue)}%
          </span>
          {label && (
            <span style={{ 
              fontSize: `${size * 0.08}px`, 
              color: 'var(--j-text-secondary)',
              fontWeight: 500,
            }}>
              {label}
            </span>
          )}
        </div>
      </div>
      
      {/* Sub Label */}
      {subLabel && (
        <div style={{
          fontFamily: 'var(--j-font)',
          fontSize: '11px',
          color: 'var(--j-text-tertiary)',
        }}>
          {subLabel}
        </div>
      )}
    </div>
  );
});

export default CircularGauge;
