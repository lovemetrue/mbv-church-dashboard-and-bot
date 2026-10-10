import { NEIGHBORS } from './geo.js';
import type { PlanSettings } from './types.js';

/**
 * Настройки подбора по умолчанию. Веса и пороги живут здесь, а не в коде движка: служитель
 * должен иметь возможность объяснить, почему группа получила столько-то очков, и церковь
 * может менять веса, не трогая логику.
 */
export const DEFAULT_SETTINGS: PlanSettings = {
  // Район важнее всего: человек не поедёт через полгорода. Возраст — второй по весу: группа
  // «не по возрасту» отсеивается и так, а вес различает «точно по возрасту» и «с краю».
  weights: { district: 40, age: 25, time: 20, street: 15 },
  defaultCapacity: 10,
  humanThreshold: 60,
  staleDays: 30,
  stalePenalty: 5,
  lastSeatPenalty: 3,
  confidenceFloor: 0.55,
  confidenceSpan: 0.45,
  neighbors: NEIGHBORS,
};
