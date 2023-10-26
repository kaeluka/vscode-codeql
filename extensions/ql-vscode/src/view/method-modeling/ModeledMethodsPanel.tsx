import * as React from "react";
import { useCallback } from "react";
import { ModeledMethod } from "../../model-editor/modeled-method";
import { MethodModelingInputs } from "./MethodModelingInputs";
import { Method } from "../../model-editor/method";
import { styled } from "styled-components";
import { MultipleModeledMethodsPanel } from "./MultipleModeledMethodsPanel";
import { convertToLegacyModeledMethod } from "../../model-editor/shared/modeled-methods-legacy";
import { QueryLanguage } from "../../common/query-language";

export type ModeledMethodsPanelProps = {
  language: QueryLanguage;
  method: Method;
  modeledMethods: ModeledMethod[];
  isModelingInProgress: boolean;
  showMultipleModels: boolean;
  onChange: (methodSignature: string, modeledMethods: ModeledMethod[]) => void;
};

const SingleMethodModelingInputs = styled(MethodModelingInputs)`
  padding-bottom: 0.5rem;
`;

export const ModeledMethodsPanel = ({
  language,
  method,
  modeledMethods,
  isModelingInProgress,
  showMultipleModels,
  onChange,
}: ModeledMethodsPanelProps) => {
  const handleSingleChange = useCallback(
    (modeledMethod: ModeledMethod) => {
      onChange(modeledMethod.signature, [modeledMethod]);
    },
    [onChange],
  );

  if (!showMultipleModels) {
    return (
      <SingleMethodModelingInputs
        language={language}
        method={method}
        modeledMethod={convertToLegacyModeledMethod(modeledMethods)}
        isModelingInProgress={isModelingInProgress}
        onChange={handleSingleChange}
      />
    );
  }

  return (
    <MultipleModeledMethodsPanel
      language={language}
      method={method}
      modeledMethods={modeledMethods}
      isModelingInProgress={isModelingInProgress}
      onChange={onChange}
    />
  );
};
