import { memo } from 'react';
import { AttachedFilesBar } from './AttachedFilesBar';
import { QuotedSelectionCard } from './QuotedSelectionCard';
import { TodoDisplay } from './TodoDisplay';
import type { AttachedFile } from '../../stores/input-slice';
import type { TodoItem } from '../../types';
import styles from './InputArea.module.css';

interface Props {
  attachedFiles: AttachedFile[];
  removeAttachedFile: (index: number) => void;
  hasQuotedSelection: boolean;
  sessionTodos: TodoItem[];
  onCompleteTodos?: () => void;
  completingTodos?: boolean;
  completeTodosDisabled?: boolean;
  completeTodosDisabledTitle?: string;
}

/** 输入框上方的上下文行：附件、引用、Todo */
export const InputContextRow = memo(function InputContextRow({
  attachedFiles, removeAttachedFile, hasQuotedSelection, sessionTodos, onCompleteTodos, completingTodos,
  completeTodosDisabled, completeTodosDisabledTitle,
}: Props) {
  if (attachedFiles.length === 0 && !hasQuotedSelection && sessionTodos.length === 0) return null;

  return (
    <div className={styles['input-context-row']}>
      <div className={styles['input-context-left']}>
        {attachedFiles.length > 0 && <AttachedFilesBar files={attachedFiles} onRemove={removeAttachedFile} />}
        <QuotedSelectionCard />
      </div>
      <TodoDisplay
        todos={sessionTodos}
        onCompleteAll={onCompleteTodos}
        completing={completingTodos}
        completeAllDisabled={completeTodosDisabled}
        completeAllDisabledTitle={completeTodosDisabledTitle}
      />
    </div>
  );
});
