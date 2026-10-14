import { createElement, useEffect, useState } from 'react';

type Action = () => void | Promise<void>;

export function ProxyControl({ value, onSave, onTest, onClear }: {
  value: string;
  onSave: (value: string) => void | Promise<void>;
  onTest: (value: string) => void | Promise<void>;
  onClear: Action;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const hasValue = Boolean(draft.trim());
  const input = createElement('input', {
    className: 'input proxy-input',
    id: 'downloadProxyInput',
    type: 'url',
    value: draft,
    placeholder: 'http://127.0.0.1:8080',
    'aria-label': L`Прокси загрузок`,
    onChange: (event: { currentTarget: { value: string } }) => setDraft(event.currentTarget.value),
  });
  const testButton = createElement('button', {
    className: 'btn btn-sm',
    id: 'downloadProxyTest',
    disabled: !hasValue,
    onClick: () => onTest(draft),
  }, L`Проверить`);
  const saveButton = createElement('button', {
    className: 'btn btn-sm btn-primary',
    id: 'downloadProxySave',
    onClick: () => onSave(draft),
  }, L`Сохранить`);
  const clearButton = hasValue ? createElement('button', {
    className: 'btn btn-sm',
    id: 'downloadProxyClear',
    onClick: () => { setDraft(''); void onClear(); },
  }, L`Очистить`) : null;

  return createElement('div', { className: 'proxy-control' },
    createElement('div', { className: 'settings-row' }, input, testButton, saveButton, clearButton),
    createElement('div', { className: 'settings-hint' }, L`Прокси используется только для загрузок приложения. Оставь поле пустым для прямого подключения. Не указывай логин и пароль.`),
  );
}
