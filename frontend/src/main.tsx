import React from 'react'
import ReactDOM from 'react-dom/client'
import EditorUI from './components/EditorUI'
// @ts-ignore TypeScript does not resolve side-effect CSS imports without a CSS module declaration.
import './index.css' // Подключаем наши Aero-стили

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorUI />
  </React.StrictMode>,
)
