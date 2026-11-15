import { useRef } from "react";
import { useQuery } from "convex/react";
import { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server";

export function useStableQuery<Q extends FunctionReference<"query">>(query: Q, args: FunctionArgs<Q>) {
  const result = useQuery(query, args);
  const last = useRef<FunctionReturnType<Q> | undefined>(undefined);
  if (result !== undefined) last.current = result;
  return last.current;
}
