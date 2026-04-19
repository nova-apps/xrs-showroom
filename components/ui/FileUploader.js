'use client';

import { useRef, useState } from 'react';
import { formatBytes } from '@/lib/utils';

const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconReplace = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" />
    <polyline points="23 20 23 14 17 14" />
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10" />
    <path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 14" />
  </svg>
);

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const IconUpload = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

/**
 * File upload component with drag & drop, click to browse, and progress bar.
 * When a file is loaded, shows a card with name (full, with tooltip), size, and action icons.
 */
export default function FileUploader({
  label,
  icon,
  accept,
  currentFile,
  uploadProgress,
  onUpload,
  onRemove,
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) onUpload?.(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => setDragging(false);

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onUpload?.(file);
    e.target.value = '';
  };

  const handleDownload = async () => {
    if (!currentFile?.url) return;
    try {
      const res = await fetch(currentFile.url, { mode: 'cors' });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = currentFile.fileName || 'asset';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const isUploading = typeof uploadProgress === 'number';

  return (
    <div className="file-uploader">
      {currentFile ? (
        <div className="file-card">
          <div className="file-card-name" title={currentFile.fileName}>
            {currentFile.fileName}
          </div>
          <div className="file-card-bottom">
            {currentFile.size && (
              <span className="file-card-size">{formatBytes(currentFile.size)}</span>
            )}
            <span className="file-card-actions">
              {currentFile.url && (
                <button className="file-action-btn" onClick={handleDownload} title="Descargar">
                  <IconDownload />
                </button>
              )}
              <button className="file-action-btn" onClick={handleClick} disabled={isUploading} title="Reemplazar">
                <IconReplace />
              </button>
              {onRemove && (
                <button className="file-action-btn file-action-danger" onClick={onRemove} disabled={isUploading} title="Eliminar">
                  <IconTrash />
                </button>
              )}
            </span>
          </div>
          {isUploading && (
            <div className="upload-progress">
              <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>
      ) : (
        <div
          className={`upload-zone ${dragging ? 'dragging' : ''}`}
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="upload-icon"><IconUpload /></div>
          <div className="upload-text">
            {isUploading ? `Subiendo… ${uploadProgress}%` : 'Click o arrastrá un archivo'}
          </div>
          {accept && (
            <div className="upload-hint">{accept}</div>
          )}
          {isUploading && (
            <div className="upload-progress" style={{ marginTop: 8 }}>
              <div className="progress-fill" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
