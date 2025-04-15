// src/Editor.js
import React from 'react';
import Editor from '@monaco-editor/react';

function CodeEditor() {
  return (
    <div style={{ height: "90vh", border: "1px solid #ccc" }}>
      <Editor
        height="100%"
        defaultLanguage="javascript"
        defaultValue="// Write your code here"
        theme="vs-dark"
      />
    </div>
  );
}

export default CodeEditor;
