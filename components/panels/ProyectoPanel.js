'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import FloatingPanel from './FloatingPanel';
import { SubAccordion } from '@/components/ui/AssetAccordion';
import { updateScene, updateCustomDomain } from '@/lib/scenes';
import { uploadAsset as storageUpload, deleteAsset as storageDelete } from '@/lib/storage';
import { normalizeDomain, isValidDomain, isReservedHost } from '@/lib/customDomain';

/**
 * ProyectoPanel — project-level settings that apply to the whole scene
 * (not per-unit data): WhatsApp contact number, panel logo, and the custom
 * domain used by /view/. Split out from UnidadesPanel to keep that one
 * focused on content (unidades + amenities, or barrios + lotes).
 */
export default function ProyectoPanel({ scene, sceneId, collapsed, onToggle }) {
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [panelLogoUrl, setPanelLogoUrl] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [customDomain, setCustomDomain] = useState('');
  const [customDomainStatus, setCustomDomainStatus] = useState({ type: 'idle', message: '' });
  const whatsappTimer = useRef(null);
  const logoInputRef = useRef(null);
  const customDomainTimer = useRef(null);

  const [openSection, setOpenSection] = useState('whatsapp');
  const toggleSection = useCallback(
    (id) => setOpenSection((prev) => (prev === id ? null : id)),
    []
  );

  // ── Sync from scene ──
  useEffect(() => {
    if (scene?.whatsappNumber !== undefined) {
      setWhatsappNumber(scene.whatsappNumber || '');
    }
  }, [scene?.whatsappNumber]);

  useEffect(() => {
    if (scene?.panelLogoUrl !== undefined) {
      setPanelLogoUrl(scene.panelLogoUrl || '');
    }
  }, [scene?.panelLogoUrl]);

  useEffect(() => {
    if (scene?.customDomain !== undefined) {
      setCustomDomain(scene.customDomain || '');
      setCustomDomainStatus({ type: 'idle', message: '' });
    }
  }, [scene?.customDomain]);

  // ── Handlers ──
  const handleWhatsappChange = useCallback((value) => {
    setWhatsappNumber(value);
    if (!sceneId) return;
    if (whatsappTimer.current) clearTimeout(whatsappTimer.current);
    whatsappTimer.current = setTimeout(() => {
      updateScene(sceneId, { whatsappNumber: value }).catch(console.error);
    }, 800);
  }, [sceneId]);

  const handleLogoUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !sceneId) return;
    if (!file.type.startsWith('image/')) return;

    setLogoUploading(true);
    setLogoProgress(0);

    try {
      if (scene?.panelLogoFileName) {
        await storageDelete(sceneId, 'logo', scene.panelLogoFileName).catch(() => {});
      }
      const result = await storageUpload(sceneId, 'logo', file, (progress) => {
        setLogoProgress(progress);
      });
      setPanelLogoUrl(result.url);
      await updateScene(sceneId, {
        panelLogoUrl: result.url,
        panelLogoFileName: result.fileName,
      });
    } catch (err) {
      console.error('Logo upload failed:', err);
    } finally {
      setLogoUploading(false);
      setLogoProgress(0);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }, [sceneId, scene?.panelLogoFileName]);

  const handleLogoRemove = useCallback(async () => {
    if (!sceneId) return;
    try {
      if (scene?.panelLogoFileName) {
        await storageDelete(sceneId, 'logo', scene.panelLogoFileName).catch(() => {});
      }
      setPanelLogoUrl('');
      await updateScene(sceneId, { panelLogoUrl: '', panelLogoFileName: '' });
    } catch (err) {
      console.error('Logo remove failed:', err);
    }
  }, [sceneId, scene?.panelLogoFileName]);

  const handleCustomDomainChange = useCallback((rawValue) => {
    setCustomDomain(rawValue);
    if (!sceneId) return;
    if (customDomainTimer.current) clearTimeout(customDomainTimer.current);
    customDomainTimer.current = setTimeout(async () => {
      const normalized = normalizeDomain(rawValue);
      if (!normalized) {
        try {
          await updateCustomDomain(sceneId, '');
          setCustomDomainStatus({ type: 'idle', message: '' });
        } catch (err) {
          setCustomDomainStatus({ type: 'error', message: err.message });
        }
        return;
      }
      if (isReservedHost(normalized) || !isValidDomain(normalized)) {
        setCustomDomainStatus({ type: 'error', message: 'Dominio inválido' });
        return;
      }
      setCustomDomainStatus({ type: 'saving', message: 'Guardando…' });
      try {
        await updateCustomDomain(sceneId, normalized);
        setCustomDomainStatus({ type: 'ok', message: '✓ Guardado' });
      } catch (err) {
        setCustomDomainStatus({ type: 'error', message: err.message || 'Error al guardar' });
      }
    }, 700);
  }, [sceneId]);

  return (
    <FloatingPanel
      title="Proyecto"
      icon="🏷️"
      position=""
      collapsed={collapsed}
      onToggle={onToggle}
    >
      <SubAccordion
        title="WhatsApp"
        icon="📱"
        open={openSection === 'whatsapp'}
        onToggle={() => toggleSection('whatsapp')}
      >
        <div className="whatsapp-config">
          <label className="whatsapp-config-label" htmlFor="whatsapp-number">
            Número de contacto
          </label>
          <div className="whatsapp-input-row">
            <span className="whatsapp-prefix">+</span>
            <input
              id="whatsapp-number"
              type="tel"
              className="whatsapp-input"
              placeholder="5491123456789"
              value={whatsappNumber}
              onChange={(e) => handleWhatsappChange(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <span className="whatsapp-hint">Código de país + número, sin espacios ni guiones</span>
        </div>
      </SubAccordion>

      <SubAccordion
        title="Logo del panel"
        icon="🖼️"
        open={openSection === 'logo'}
        onToggle={() => toggleSection('logo')}
      >
        <div className="whatsapp-config">
          <span className="whatsapp-hint">Se mostrará en el encabezado del panel lateral izquierdo</span>

          <input
            ref={logoInputRef}
            id="panel-logo-upload"
            type="file"
            accept="image/*"
            className="logo-file-input"
            onChange={handleLogoUpload}
          />

          {panelLogoUrl ? (
            <div className="panel-logo-preview">
              <img src={panelLogoUrl} alt="Logo preview" className="panel-logo-preview-img" />
              <div className="panel-logo-actions">
                <button
                  className="panel-logo-change-btn"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                >
                  Cambiar
                </button>
                <button
                  className="panel-logo-remove-btn"
                  onClick={handleLogoRemove}
                  disabled={logoUploading}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ) : (
            <button
              className="panel-logo-upload-btn"
              onClick={() => logoInputRef.current?.click()}
              disabled={logoUploading}
            >
              {logoUploading ? `Subiendo... ${logoProgress}%` : '⬆ Subir imagen'}
            </button>
          )}

          {logoUploading && (
            <div className="panel-logo-progress">
              <div
                className="panel-logo-progress-fill"
                style={{ width: `${logoProgress}%` }}
              />
            </div>
          )}
        </div>
      </SubAccordion>

      <SubAccordion
        title="Dominio personalizado"
        icon="🌐"
        open={openSection === 'domain'}
        onToggle={() => toggleSection('domain')}
      >
        <div className="whatsapp-config">
          <label className="whatsapp-config-label" htmlFor="custom-domain">
            Dominio (sin https://)
          </label>
          <input
            id="custom-domain"
            type="text"
            className="whatsapp-input"
            placeholder="proyecto.ejemplo.com"
            value={customDomain}
            onChange={(e) => handleCustomDomainChange(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {customDomainStatus.message && (
            <span
              className="whatsapp-hint"
              style={{
                color:
                  customDomainStatus.type === 'error' ? '#f87171'
                  : customDomainStatus.type === 'ok' ? '#4ade80'
                  : undefined,
              }}
            >
              {customDomainStatus.message}
            </span>
          )}
          <span className="whatsapp-hint">
            Apuntá un CNAME desde tu dominio a <code>xrs-showroom.web.app</code>{' '}
            y agregalo en Firebase Hosting (Console → Hosting → Add custom domain)
            para que provisione el SSL. Una vez activo, abrir el dominio cargará esta escena.
          </span>
        </div>
      </SubAccordion>
    </FloatingPanel>
  );
}
