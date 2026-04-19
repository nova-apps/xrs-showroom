'use client';

import { useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';

/**
 * ViewCube — a draggable 3D CSS cube for camera view selection.
 * Syncs with camera orientation, drag to orbit, click a face to switch view.
 */
const CameraSelector = forwardRef(function CameraSelector({ onSelectView, onDragRotate }, ref) {
  const [active, setActive] = useState(null);
  const [hoveredFace, setHoveredFace] = useState(null);
  const cubeRef = useRef(null);
  const currentRotRef = useRef({ x: -25, y: -35 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startRot: { x: 0, y: 0 }, moved: false, target: null });

  const updateCubeTransform = useCallback((rot) => {
    currentRotRef.current = rot;
    if (cubeRef.current) {
      cubeRef.current.style.transform = `rotateX(${rot.x}deg) rotateY(${rot.y}deg)`;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    setCameraRotation: (rot) => {
      if (!dragRef.current.dragging) {
        updateCubeTransform(rot);
      }
    }
  }), [updateCubeTransform]);

  const onPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    // Store the original target to detect face clicks on pointerUp
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startRot: { ...currentRotRef.current },
      moved: false,
      target: e.target,
    };
  }, []);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      d.moved = true;
    }
    const newRot = {
      x: d.startRot.x - dy * 0.8,
      y: d.startRot.y + dx * 0.8,
    };
    updateCubeTransform(newRot);
    onDragRotate?.(newRot);
  }, [updateCubeTransform, onDragRotate]);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    d.dragging = false;
    // If no drag movement, treat as a face click
    if (!d.moved && d.target) {
      const viewId = d.target.dataset?.view;
      if (viewId) {
        setActive(viewId);
        onSelectView?.(viewId);
      }
    }
    d.target = null;
  }, [onSelectView]);

  const faceClass = (id) =>
    `viewcube-face viewcube-${id}${hoveredFace === id ? ' hovered' : ''}${active === id ? ' active' : ''}`;

  return (
    <div className="viewcube-wrap">
      <div
        className="viewcube-scene"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="viewcube"
          ref={cubeRef}
          style={{ transform: `rotateX(${currentRotRef.current.x}deg) rotateY(${currentRotRef.current.y}deg)` }}
        >
          <div className={faceClass('front')} data-view="front"
            onMouseEnter={() => setHoveredFace('front')}
            onMouseLeave={() => setHoveredFace(null)}>Frente</div>
          <div className={faceClass('back')} data-view="back"
            onMouseEnter={() => setHoveredFace('back')}
            onMouseLeave={() => setHoveredFace(null)}>Atrás</div>
          <div className={faceClass('right')} data-view="right"
            onMouseEnter={() => setHoveredFace('right')}
            onMouseLeave={() => setHoveredFace(null)}>Der</div>
          <div className={faceClass('left')} data-view="left"
            onMouseEnter={() => setHoveredFace('left')}
            onMouseLeave={() => setHoveredFace(null)}>Izq</div>
          <div className={faceClass('top')} data-view="top"
            onMouseEnter={() => setHoveredFace('top')}
            onMouseLeave={() => setHoveredFace(null)}>Sup</div>
          <div className={faceClass('bottom')} data-view="bottom"
            onMouseEnter={() => setHoveredFace('bottom')}
            onMouseLeave={() => setHoveredFace(null)}>Inf</div>
        </div>
      </div>
    </div>
  );
});

export default CameraSelector;
