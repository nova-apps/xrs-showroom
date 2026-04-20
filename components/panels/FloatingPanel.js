'use client';

/**
 * Reusable floating panel with glassmorphism.
 * Supports both uncontrolled (internal state) and controlled (parent-driven) collapse.
 */

import { useState } from 'react';

export default function FloatingPanel({
  title,
  icon,
  position = 'panel-left',
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onToggle,
  children,
  className = '',
  headerExtra,
}) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);

  // Use controlled state if provided, otherwise internal
  const isControlled = controlledCollapsed !== undefined;
  const collapsed = isControlled ? controlledCollapsed : internalCollapsed;

  const handleToggle = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalCollapsed(!internalCollapsed);
    }
  };

  return (
    <div className={`floating-panel ${position} ${collapsed ? 'collapsed' : ''} ${className}`}>
      <div className="panel-header" onClick={handleToggle}>
        <h3>
          {icon && <span className="panel-icon">{icon}</span>}
          {title}
        </h3>
        <span className="panel-header-right">
          {headerExtra && <span className="panel-header-extra" onClick={(e) => e.stopPropagation()}>{headerExtra}</span>}
          <span className="panel-toggle">▼</span>
        </span>
      </div>
      {!collapsed && <div className="panel-body">{children}</div>}
    </div>
  );
}
