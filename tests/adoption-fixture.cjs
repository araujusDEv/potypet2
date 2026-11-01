'use strict';
module.exports = (body) => ({
  contactConsent: true,
  city: 'Apodi',
  housing: 'casa',
  reason: 'Tenho condições e tempo para cuidar do animal.',
  questionnaire: {
    household_agrees: 'sim',
    financial_conditions: 'sim',
    alone_time: '2_4h',
    had_pets_before: 'sim',
    vet_commitment: 'sim',
    adaptation_plan: 'Adaptação gradual com acompanhamento e cuidados veterinários.',
  },
  ...body,
});
