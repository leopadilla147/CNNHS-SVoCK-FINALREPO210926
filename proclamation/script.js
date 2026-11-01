/**
 * ═══════════════════════════════════════════════════════════════════
 * PROCLAMATION CERTIFICATE GENERATOR - CLIENT SCRIPT
 * Standalone PDF Generation & Certificate Preview
 * Camarines Norte National High School (CNNHS) Student Elections
 * ═══════════════════════════════════════════════════════════════════
 */

document.addEventListener('DOMContentLoaded', () => {
    // ── DOM References: Certificate & Preview Container ──────────────
    const certificate = document.getElementById('proclamationCertificate');
    const canvasWrapper = document.getElementById('canvasWrapper');
    const pdfLoadingModal = document.getElementById('pdfLoadingModal');

    // ── DOM References: Action Buttons ───────────────────────────────
    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    const printBtn = document.getElementById('printBtn');

    // Zoom Controls
    const zoomInBtn = document.getElementById('zoomInBtn');
    const zoomOutBtn = document.getElementById('zoomOutBtn');
    const fitScreenBtn = document.getElementById('fitScreenBtn');
    const zoomLevelDisplay = document.getElementById('zoomLevelDisplay');

    let currentZoom = 1.0;

    // ── Zoom & Responsive Fit Controls ───────────────────────────────
    function applyZoom(zoom) {
        currentZoom = Math.min(Math.max(zoom, 0.4), 1.5);
        if (certificate) {
            certificate.style.transform = `scale(${currentZoom})`;
        }
        if (zoomLevelDisplay) {
            zoomLevelDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
        }
    }

    function autoFitCertificate() {
        if (!canvasWrapper || !certificate) return;
        const availableWidth = canvasWrapper.clientWidth - 80;
        const availableHeight = canvasWrapper.clientHeight - 80;
        const certWidth = 1056;
        const certHeight = 816;

        const scaleX = availableWidth / certWidth;
        const scaleY = availableHeight / certHeight;
        const targetScale = Math.min(scaleX, scaleY, 1.0);

        applyZoom(Math.max(targetScale, 0.45));
    }

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyZoom(currentZoom + 0.1));
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyZoom(currentZoom - 0.1));
    if (fitScreenBtn) fitScreenBtn.addEventListener('click', autoFitCertificate);

    window.addEventListener('resize', () => {
        clearTimeout(window._resizeTimer);
        window._resizeTimer = setTimeout(autoFitCertificate, 200);
    });

    // ── PDF Download Handler (Exact 11 x 8.5 inches Letter Landscape) ─
    async function generateAndDownloadPdf() {
        if (!certificate) return;

        if (typeof html2pdf === 'undefined') {
            alert('PDF generation engine is initializing. Please wait a moment and try again.');
            return;
        }

        // Show loading progress overlay
        if (pdfLoadingModal) pdfLoadingModal.style.display = 'flex';

        const fileName = 'Proclamation_Certificate.pdf';

        // Temporarily reset preview scale transform for crisp 1:1 pixel rendering
        const priorTransform = certificate.style.transform;
        certificate.style.transform = 'none';

        // Options strictly configured for 11 x 8.5 inches Letter Landscape (Single Page)
        const opt = {
            margin: 0,
            filename: fileName,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                letterRendering: true,
                logging: false,
                scrollX: 0,
                scrollY: 0
            },
            jsPDF: {
                unit: 'in',
                format: 'letter', // 11 x 8.5 inches in landscape
                orientation: 'landscape'
            }
        };

        try {
            await html2pdf().set(opt).from(certificate).save();
        } catch (err) {
            console.error('PDF generation error:', err);
            alert('Failed to generate PDF. You can also use the "Print" button to save as PDF via your browser print dialog.');
        } finally {
            certificate.style.transform = priorTransform;
            if (pdfLoadingModal) pdfLoadingModal.style.display = 'none';
        }
    }

    if (downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', generateAndDownloadPdf);
    }

    // ── Direct Browser Print Handler ─────────────────────────────────
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // Initial responsive fit on load
    setTimeout(autoFitCertificate, 150);
});
