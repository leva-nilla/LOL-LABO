# Matchup Authoring Guide

Goal: build 29,412 matchup articles that read like a focused beginner-friendly guide, not generic generated text.

## Scope

172 champions x 171 opponents = 29,412 ordered matchups.

Each article should answer:

- What is the win condition?
- What is the enemy's main threat?
- How should the player trade before level 6?
- What changes after level 6?
- What wave state is safest?
- What rune logic matters, without naming removed runes?
- What item logic matters, without naming removed items?
- How do you land your key skill?
- How do you dodge the enemy's key skill?
- What are the 2-3 common beginner mistakes?

## Patch Safety

Do not hard-code item or rune names in manual articles unless they are verified against the current Data Dragon patch.

Prefer wording such as:

- "物理防御と体力を早めに挟む"
- "レーン維持を重視する"
- "短い交換で発動しやすいキーストーン"

The app displays live item and rune candidates from Data Dragon separately.

## Status

- `draft`: written but not reviewed.
- `reviewed`: acceptable for users.
- `archived`: keep for history, do not display.

## Batch Plan

1. Write all high-frequency lane pairs first: TOP melee vs melee, MID mage/assassin, ADC 2v2 carry matchups.
2. Review for patch-unsafe item/rune names.
3. Add jungle-specific and support-specific matchups.
4. Add off-meta lanes only after common lane coverage is useful.
