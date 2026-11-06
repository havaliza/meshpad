/** Validate and snapshot a failure mode before allocating a renderer. */
export function createFailure(config = { type: 'default' }) {
  if (!config || typeof config !== 'object') throw new TypeError('failure must be a failure mode object.');
  const { type } = config;
  if (type === 'default') return { type, initial: null, remaining: null, playOnAmount: null };
  let initial;
  let playOnAmount;
  if (type === 'hearts') {
    initial = config.hearts ?? 3;
    if (!Number.isInteger(initial) || initial < 3 || initial > 5) throw new RangeError('failure.hearts must be 3, 4, or 5.');
    playOnAmount = initial;
  } else if (type === 'time') {
    initial = config.seconds;
    playOnAmount = config.playOnSeconds ?? 20;
    if (![initial, playOnAmount].every((n) => Number.isFinite(n) && n > 0)) {
      throw new RangeError('failure.seconds and failure.playOnSeconds must be positive finite numbers.');
    }
  } else if (type === 'moves') {
    initial = config.moves;
    playOnAmount = config.playOnMoves ?? 10;
    if (![initial, playOnAmount].every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new RangeError('failure.moves and failure.playOnMoves must be positive safe integers.');
    }
  } else {
    throw new TypeError('failure.type must be default, hearts, time, or moves.');
  }
  return { type, initial, remaining: initial, playOnAmount };
}
