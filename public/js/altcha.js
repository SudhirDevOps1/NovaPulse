import { h } from './ui.js';
import { api } from './api.js';

/**
 * Pure WebCrypto SHA-256 solver for ALTCHA Proof-of-Work.
 *
 * @param {string} salt
 * @param {string} challenge
 * @param {number} maxnumber
 * @param {(progress: number) => void} [onProgress]
 * @returns {Promise<number | null>}
 */
export async function solveAltchaPoW(salt, challenge, maxnumber = 40000, onProgress) {
	const enc = new TextEncoder();
	const batchSize = 600;

	for (let n = 0; n <= maxnumber; n++) {
		const buf = await crypto.subtle.digest('SHA-256', enc.encode(salt + n));
		const bytes = new Uint8Array(buf);
		let hex = '';
		for (let i = 0; i < bytes.length; i++) {
			hex += bytes[i].toString(16).padStart(2, '0');
		}

		if (hex === challenge) {
			return n;
		}

		if (n % batchSize === 0) {
			if (onProgress) onProgress(n / maxnumber);
			await new Promise((r) => {
				setTimeout(r, 0);
			});
		}
	}
	return null;
}

/**
 * Create an interactive ALTCHA Proof-of-Work widget.
 * Matches standard ALTCHA UI specifications and visual style.
 *
 * @param {{ onVerified?: (payloadBase64: string) => void, onError?: (err: any) => void }} [options]
 * @returns {HTMLElement & { getPayload: () => string | null, isVerified: () => boolean, reset: () => void }}
 */
export function createAltchaWidget({ onVerified, onError } = {}) {
	let state = 'idle'; // 'idle' | 'verifying' | 'verified' | 'error'
	let solutionPayload = null;

	const checkbox = h('span', { class: 'altcha-checkbox' });
	const labelText = h('span', { class: 'altcha-label-text', text: "I'm not a robot" });
	const statusFoot = h('span', { class: 'altcha-brand-sub', text: 'Protected by ALTCHA' });

	const altchaLogoSvg = `
		<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/>
			<path d="M12 6v6l4 2"/>
		</svg>
	`;
	const logoWrap = h('div', { class: 'altcha-logo-icon', html: altchaLogoSvg });

	const container = h('div', {
		class: 'altcha-box',
		role: 'checkbox',
		'aria-checked': 'false',
		tabindex: '0',
	}, [
		h('div', { class: 'altcha-left' }, [
			checkbox,
			labelText,
		]),
		h('div', { class: 'altcha-right' }, [
			logoWrap,
			statusFoot,
		]),
	]);

	async function triggerVerification() {
		if (state === 'verifying' || state === 'verified') return;

		state = 'verifying';
		container.classList.add('verifying');
		container.classList.remove('error', 'verified');
		labelText.textContent = 'Verifying...';
		checkbox.innerHTML = '<span class="altcha-spinner"></span>';

		try {
			const challengeData = await api.getAltchaChallenge();
			const { algorithm, challenge, salt, signature, maxnumber } = challengeData;

			if (!challenge || !salt || !signature) {
				throw new Error('Server returned invalid challenge');
			}

			const solvedNumber = await solveAltchaPoW(salt, challenge, maxnumber || 40000, (pct) => {
				labelText.textContent = `Verifying... ${Math.round(pct * 100)}%`;
			});

			if (solvedNumber === null) {
				throw new Error('Proof-of-work solution not found');
			}

			const payloadObj = {
				algorithm,
				challenge,
				number: solvedNumber,
				salt,
				signature,
			};
			solutionPayload = btoa(JSON.stringify(payloadObj));

			state = 'verified';
			container.classList.remove('verifying');
			container.classList.add('verified');
			container.setAttribute('aria-checked', 'true');
			labelText.textContent = 'Verified human';
			checkbox.innerHTML = `
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
			`;

			if (onVerified) onVerified(solutionPayload);
		} catch (err) {
			state = 'error';
			solutionPayload = null;
			container.classList.remove('verifying');
			container.classList.add('error');
			container.setAttribute('aria-checked', 'false');
			labelText.textContent = 'Verification failed (click to retry)';
			checkbox.innerHTML = '!';
			if (onError) onError(err);
		}
	}

	container.addEventListener('click', () => {
		triggerVerification();
	});

	container.addEventListener('keydown', (e) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			triggerVerification();
		}
	});

	const widget = /** @type {any} */ (container);
	widget.getPayload = () => solutionPayload;
	widget.isVerified = () => state === 'verified';
	widget.reset = () => {
		state = 'idle';
		solutionPayload = null;
		container.classList.remove('verifying', 'verified', 'error');
		container.setAttribute('aria-checked', 'false');
		labelText.textContent = "I'm not a robot";
		checkbox.innerHTML = '';
	};

	return widget;
}
