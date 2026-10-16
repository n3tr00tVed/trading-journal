import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RulesPage from '../components/RulesPage.jsx';
import { RULES_STORAGE_KEY, loadRules } from '../lib/rulesStorage.js';

afterEach(() => {
  window.localStorage.clear();
});

describe('RulesPage workflow', () => {
  it('autosaves typed rules to this device', async () => {
    const user = userEvent.setup();
    render(<RulesPage />);

    const editor = screen.getByLabelText('Trading rules');
    await user.type(editor, '1. Risk 1% max per trade.');

    // Debounced save fires after ~600ms.
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(loadRules()).toBe('1. Risk 1% max per trade.');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('hydrates previously saved rules and keeps the clear flow working', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify('1. Trade the plan.'));
    render(<RulesPage />);

    const editor = screen.getByLabelText('Trading rules');
    expect(editor).toHaveValue('1. Trade the plan.');

    await user.click(screen.getByRole('button', { name: 'Clear rules' }));
    await user.click(screen.getByRole('button', { name: 'Delete rules' }));
    expect(loadRules()).toBe('');
    expect(editor).toHaveValue('');
  });
});
