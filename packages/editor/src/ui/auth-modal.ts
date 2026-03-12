/**
 * Login form (email/password) rendered in Shadow DOM.
 */

import { getSupabase } from '../api/supabase';
import { EditorState } from '../core/state';
import { h } from '../utils/dom';
import { injectStyles } from './styles';

export function showAuthModal(shadow: ShadowRoot, onSuccess: () => void) {
  injectStyles(shadow);

  const backdrop = h('div', { className: 'ss-modal-backdrop' });
  const modal = h('div', { className: 'ss-modal' });

  const title = h('h2', {}, 'Sign in to edit');
  const subtitle = h('p', {}, 'Enter the credentials from your invite email.');

  const emailLabel = h('label', { className: 'ss-input-label' }, 'Email');
  const emailInput = h('input', {
    className: 'ss-input',
    type: 'email',
    placeholder: 'you@example.com',
  });

  const passwordLabel = h('label', { className: 'ss-input-label' }, 'Password');
  const passwordInput = h('input', {
    className: 'ss-input',
    type: 'password',
    placeholder: 'Your password',
  });

  const errorEl = h('div', { className: 'ss-error' });
  errorEl.style.display = 'none';

  const submitBtn = h('button', { className: 'ss-btn ss-btn-primary' }, 'Sign In');
  submitBtn.style.width = '100%';
  submitBtn.style.marginTop = '4px';

  submitBtn.addEventListener('click', async () => {
    const email = (emailInput as HTMLInputElement).value.trim();
    const password = (passwordInput as HTMLInputElement).value;

    if (!email || !password) {
      errorEl.textContent = 'Please enter email and password';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.textContent = 'Signing in…';
    (submitBtn as HTMLButtonElement).disabled = true;

    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        submitBtn.textContent = 'Sign In';
        (submitBtn as HTMLButtonElement).disabled = false;
        return;
      }

      EditorState.setUser(data.user);
      backdrop.remove();
      onSuccess();
    } catch (err) {
      errorEl.textContent = 'Something went wrong. Please try again.';
      errorEl.style.display = 'block';
      submitBtn.textContent = 'Sign In';
      (submitBtn as HTMLButtonElement).disabled = false;
    }
  });

  // Allow Enter key to submit
  passwordInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') {
      submitBtn.click();
    }
  });

  modal.append(title, subtitle, emailLabel, emailInput, passwordLabel, passwordInput, errorEl, submitBtn);
  backdrop.appendChild(modal);
  shadow.appendChild(backdrop);
}
