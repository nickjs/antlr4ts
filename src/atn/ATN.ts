/*!
 * Copyright 2016 The ANTLR Project. All rights reserved.
 * Licensed under the BSD-3-Clause license. See LICENSE file in the project root for license information.
 */

// ConvertTo-TS run at 2016-10-04T11:26:25.1063510-07:00

import { Array2DHashMap } from "../misc/Array2DHashMap";
import { ATNState } from "./ATNState";
import { ATNType } from "./ATNType";
import { DecisionState } from "./DecisionState";
import { DFA } from "../dfa/DFA";
import { IntervalSet } from "../misc/IntervalSet";
import { InvalidState } from "./InvalidState";
import { LexerAction } from "./LexerAction";
import { LL1Analyzer } from "./LL1Analyzer";
import { NotNull } from "../Decorators";
import { ObjectEqualityComparator } from "../misc/ObjectEqualityComparator";
import { PredictionContext } from "./PredictionContext";
import { RuleContext } from "../RuleContext";
import { RuleStartState } from "./RuleStartState";
import { RuleStopState } from "./RuleStopState";
import { RuleTransition } from "./RuleTransition";
import { Token } from "../Token";
import { TokensStartState } from "./TokensStartState";

import * as assert from "assert";

/** */
export class ATN {
	@NotNull
	public readonly states: ATNState[] = [];

	/** Each subrule/rule is a decision point and we must track them so we
	 *  can go back later and build DFA predictors for them.  This includes
	 *  all the rules, subrules, optional blocks, ()+, ()* etc...
	 */
	@NotNull
	public decisionToState: DecisionState[] = [];

	/**
	 * Maps from rule index to starting state number.
	 */
	public ruleToStartState: RuleStartState[];

	/**
	 * Maps from rule index to stop state number.
	 */
	public ruleToStopState: RuleStopState[];

	@NotNull
	public modeNameToStartState: Map<string, TokensStartState> =
		new Map<string, TokensStartState>();

	/**
	 * The type of the ATN.
	 */
	public grammarType: ATNType;

	/**
	 * The maximum value for any symbol recognized by a transition in the ATN.
	 */
	public maxTokenType: number;

	/**
	 * For lexer ATNs, this maps the rule index to the resulting token type.
	 * For parser ATNs, this maps the rule index to the generated bypass token
	 * type if the
	 * {@link ATNDeserializationOptions#isGenerateRuleBypassTransitions}
	 * deserialization option was specified; otherwise, this is `null`.
	 */
	public ruleToTokenType: Int32Array;

	/**
	 * For lexer ATNs, this is an array of {@link LexerAction} objects which may
	 * be referenced by action transitions in the ATN.
	 */
	public lexerActions: LexerAction[];

	@NotNull
	public modeToStartState: TokensStartState[] = [];

	private contextCache: Array2DHashMap<PredictionContext, PredictionContext> =
		new Array2DHashMap<PredictionContext, PredictionContext>(ObjectEqualityComparator.INSTANCE);

	@NotNull
	public decisionToDFA: DFA[] = [];
	@NotNull
	public modeToDFA: DFA[] = [];

	public LL1Table: Map<number, number> = new Map<number, number>();

	/** Used for runtime deserialization of ATNs from strings */
	constructor(@NotNull grammarType: ATNType, maxTokenType: number) {
		this.grammarType = grammarType;
		this.maxTokenType = maxTokenType;
	}

	public clearDFA(): void {
		this.decisionToDFA = new Array<DFA>(this.decisionToState.length);
		for (let i = 0; i < this.decisionToDFA.length; i++) {
			this.decisionToDFA[i] = new DFA(this.decisionToState[i], i);
		}

		this.modeToDFA = new Array<DFA>(this.modeToStartState.length);
		for (let i = 0; i < this.modeToDFA.length; i++) {
			this.modeToDFA[i] = new DFA(this.modeToStartState[i]);
		}

		this.contextCache.clear();
		this.LL1Table.clear();
	}

	get contextCacheSize(): number {
		return this.contextCache.size;
	}

	public getCachedContext(context: PredictionContext): PredictionContext {
		return PredictionContext.getCachedContext(context, this.contextCache, new PredictionContext.IdentityHashMap());
	}

	public getDecisionToDFA(): DFA[] {
		assert(this.decisionToDFA != null && this.decisionToDFA.length === this.decisionToState.length);
		return this.decisionToDFA;
	}

	/** Compute the set of valid tokens that can occur starting in state `s`.
	 *  If `ctx` is {@link PredictionContext#EMPTY_LOCAL}, the set of tokens will not include what can follow
	 *  the rule surrounding `s`. In other words, the set will be
	 *  restricted to tokens reachable staying within `s`'s rule.
	 */
	// @NotNull
	public nextTokens(s: ATNState, /*@NotNull*/ ctx: PredictionContext): IntervalSet;

	/**
	 * Compute the set of valid tokens that can occur starting in `s` and
	 * staying in same rule. {@link Token#EPSILON} is in set if we reach end of
	 * rule.
	 */
	// @NotNull
	public nextTokens(/*@NotNull*/ s: ATNState): IntervalSet;

	@NotNull
	public nextTokens(s: ATNState, ctx?: PredictionContext): IntervalSet {
		if (ctx) {
			let anal: LL1Analyzer = new LL1Analyzer(this);
			let next: IntervalSet = anal.LOOK(s, ctx);
			return next;
		} else {
			if (s.nextTokenWithinRule) {
				return s.nextTokenWithinRule;
			}

			s.nextTokenWithinRule = this.nextTokens(s, PredictionContext.EMPTY_LOCAL);
			s.nextTokenWithinRule.setReadonly(true);
			return s.nextTokenWithinRule;
		}
	}

	public addState(state: ATNState): void {
		state.atn = this;
		state.stateNumber = this.states.length;
		this.states.push(state);
	}

	public removeState(@NotNull state: ATNState): void {
		// just replace the state, don't shift states in list
		let invalidState = new InvalidState();
		invalidState.atn = this;
		invalidState.stateNumber = state.stateNumber;
		this.states[state.stateNumber] = invalidState;
	}

	public defineMode(@NotNull name: string, @NotNull s: TokensStartState): void {
		this.modeNameToStartState.set(name, s);
		this.modeToStartState.push(s);
		this.modeToDFA.push(new DFA(s));
		this.defineDecisionState(s);
	}

	public defineDecisionState(@NotNull s: DecisionState): number {
		this.decisionToState.push(s);
		s.decision = this.decisionToState.length - 1;
		this.decisionToDFA.push(new DFA(s, s.decision));
		return s.decision;
	}

	public getDecisionState(decision: number): DecisionState | undefined {
		if (this.decisionToState.length > 0) {
			return this.decisionToState[decision];
		}
		return undefined;
	}

	get numberOfDecisions(): number {
		return this.decisionToState.length;
	}

	/**
	 * Computes the set of input symbols which could follow ATN state number
	 * `stateNumber` in the specified full `context`. This method
	 * considers the complete parser context, but does not evaluate semantic
	 * predicates (i.e. all predicates encountered during the calculation are
	 * assumed true). If a path in the ATN exists from the starting state to the
	 * {@link RuleStopState} of the outermost context without matching any
	 * symbols, {@link Token#EOF} is added to the returned set.
	 *
	 * If `context` is `null`, it is treated as
	 * {@link ParserRuleContext#EMPTY}.
	 *
	 * Note that this does NOT give you the set of all tokens that could
	 * appear at a given token position in the input phrase.  In other words, it
	 * does not answer:
	 *
	 * > Given a specific partial input phrase, return the set of all
	 * > tokens that can follow the last token in the input phrase.
	 *
	 * The big difference is that with just the input, the parser could land
	 * right in the middle of a lookahead decision. Getting all
	 * *possible* tokens given a partial input stream is a separate
	 * computation. See https://github.com/antlr/antlr4/issues/1428
	 *
	 * For this function, we are specifying an ATN state and call stack to
	 * compute what token(s) can come next and specifically: outside of a
	 * lookahead decision. That is what you want for error reporting and
	 * recovery upon parse error.
	 *
	 * @param stateNumber the ATN state number
	 * @param context the full parse context
	 * @returns The set of potentially valid input symbols which could follow the
	 * specified state in the specified context.
	 * @ if the ATN does not contain a state with
	 * number `stateNumber`
	 */
	@NotNull
	public getExpectedTokens(stateNumber: number, context: RuleContext | undefined): IntervalSet {
		if (stateNumber < 0 || stateNumber >= this.states.length) {
			throw new RangeError("Invalid state number.");
		}

		let ctx: RuleContext | undefined = context;
		let s: ATNState = this.states[stateNumber];
		let following: IntervalSet = this.nextTokens(s);
		if (!following.contains(Token.EPSILON)) {
			return following;
		}

		let expected: IntervalSet = new IntervalSet();
		expected.addAll(following);
		expected.remove(Token.EPSILON);
		while (ctx != null && ctx.invokingState >= 0 && following.contains(Token.EPSILON)) {
			let invokingState: ATNState = this.states[ctx.invokingState];
			let rt: RuleTransition = invokingState.transition(0) as RuleTransition;
			following = this.nextTokens(rt.followState);
			expected.addAll(following);
			expected.remove(Token.EPSILON);
			ctx = ctx._parent;
		}

		if (following.contains(Token.EPSILON)) {
			expected.add(Token.EOF);
		}

		return expected;
	}
}

export namespace ATN {
	export const INVALID_ALT_NUMBER: number = 0;
}
