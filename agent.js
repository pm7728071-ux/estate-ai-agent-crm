/** Estate AI Agent CRM — execution loop v1 (Days 15-30).
 *  Deterministic: understand -> memory check -> act -> verify -> approval gate.
 */
module.exports = function mountAgent({ app, getDB, save, log }) {
  const { createAegisGuard } = require('./aegis-guard.js');
  const aegisGuard = createAegisGuard();
  const reply = (res, body) => res.json(body);
  // Only records with an explicit availability status, verification note, and timestamp can be recommended.
  const props = () => (getDB().properties || []).filter(p => p.status === 'available' && p.verifiedAt && p.verificationNote);

  app.post('/api/agent/message', async (req, res) => {
    const { channel, from, text } = req.body || {};
    if (!from || !text) return res.status(400).json({ error: 'from and text are required' });
    const DB = getDB();
    const msg = String(text).slice(0, 600);
    const t = msg.toLowerCase();
    DB.threads = DB.threads || {}; DB.holds = DB.holds || {};
    const th = DB.threads[from] || (DB.threads[from] = { from, channel: channel || 'whatsapp', budget: null, memIds: [], offeredSlots: null });
    const actions = []; const out = (r, extra = {}) => {
      log('ACTION', 'Agent replied to ' + from + ' — ' + extra.intent);
      save();
      const memoryUsed = th.memIds.map(id => DB.memories.find(m => m.id === id)).filter(Boolean).map(m => m.entry);
      return reply(res, { reply: r, actions, memoryUsed, requiresApproval: false, intent: extra.intent, ...extra });
    };
    const addMem = (type, entry) => { const m = { id: 'mem-' + Date.now() + '-' + Math.floor(Math.random() * 999), type, entry, confidence: 90, recorded: new Date().toISOString(), subject: from }; DB.memories.unshift(m); th.memIds.push(m.id); return m; };

    // 1) approval gate — consequential actions never leave without a human
    if (/(send|email|draft).*(offer|letter)|formal offer|commit to|sign the|pay the deposit|deposit of/i.test(t)) {
      const crypto = require('crypto');
      const requestKey = String(req.get('x-idempotency-key') || crypto.randomUUID()).slice(0, 120);
      const gate = await aegisGuard({
        action: 'crm.external_commitment',
        agencyId: req.tenantId || 'default',
        resourceRef: String(from) + '|' + requestKey,
        idempotencyKey: requestKey
      });
      if (gate.decision === 'BLOCKED') {
        log('AEGIS_BLOCKED', 'Aegis blocked or could not verify a consequential CRM action; no external action was performed.');
        return out('This request is being held because the security gate blocked the action or could not verify it. No offer, message, payment, or commitment was sent. Please ask an administrator to review the security gate.', {
          requiresApproval: true, aegisDecision: 'BLOCKED', securityReason: gate.reason, intent: 'aegis-blocked'
        });
      }

      DB.approvals = DB.approvals || [];
      const existingApproval = DB.approvals.find(a => a.idempotencyKey === requestKey);
      const approvalId = existingApproval ? existingApproval.id : 'apr-' + crypto.randomUUID();
      if (!existingApproval) {
        DB.approvals.unshift({
          id: approvalId, idempotencyKey: requestKey, requester: from, channel: channel || 'unknown',
          action: 'Formal offer letter / external commitment', summary: msg.slice(0, 300),
          status: 'pending', createdAt: new Date().toISOString(),
          securityGate: gate.decision === 'DISABLED' ? 'LOCAL_APPROVAL_ONLY' : gate.decision,
          aegisAuditId: gate.auditId || null, aegisRequestId: gate.requestId || null
        });
      }
      log('APPROVAL', 'Approval requested for ' + from + ' — formal offer / commitment held. Nothing sent.');
      actions.push({ type: 'APPROVAL_REQUESTED', approvalId, detail: 'Formal offer letter / commitment', securityGate: gate.decision });
      const note = gate.decision === 'PENDING_APPROVAL'
        ? 'Aegis recorded the action and requires human approval.'
        : 'The local approval queue is active; Aegis enforcement is not enabled.';
      return out('This request needs a human review before any offer or commitment is sent. ' + note + ' I saved it to the pending approvals queue; no external message or commitment has been made.', {
        requiresApproval: true, approvalId, aegisDecision: gate.decision, aegisAuditId: gate.auditId || null, intent: 'approval-gate'
      });
    }

    // 2) landlord hold instruction
    const holdMatch = t.match(/do not show|don't show|not to be shown|on hold|hold the/);
    if (holdMatch) {
      const key = ['karen', 'kilimani', 'lavington', 'westlands'].find(k => t.includes(k)) || 'listing';
      DB.holds[key] = { by: from, note: msg.slice(0, 120), at: new Date().toISOString() };
      log('HOLD_ADDED', 'Hold placed on ' + key + ' listing by ' + from + ' — viewings blocked until lifted.');
      return out('Understood. I have placed the ' + key + ' listing on hold — no viewings will be offered and no details shared until you tell me it is ready.', { intent: 'landlord-hold' });
    }

    // 3) question about a held listing
    const heldKey = Object.keys(DB.holds).find(k => t.includes(k));
    if (heldKey) return out('The ' + heldKey + ' property is temporarily withdrawn from the market while work is completed on it. I will alert you the moment it returns — happy to share similar options meanwhile.', { intent: 'held-listing' });

    // 4) abuse — stay professional, flag a human
    if (/useless|scam|stupid|idiot|rubbish|hate you|nonsense/i.test(t)) {
      log('FLAG', 'Hostile message from ' + from + ' — escalated to operations manager. Agent stayed professional.');
      return out('I am sorry — that is not the experience you deserve, and I want to help fix whatever went wrong. I have flagged this conversation to our operations manager, who will follow up with you personally.', { intent: 'escalation', escalated: true });
    }

    // Booking confirmation is intentionally disabled until a real calendar integration exists.

    // 6) viewing request — propose concrete slots
    if (/view|viewing|see the|appointment|visit/i.test(t)) {
      th.offeredSlots = null;
      return out('I can help arrange a viewing, but I cannot verify a live calendar slot yet. I have noted your request for the team to confirm a time. No appointment has been booked.', { intent: 'viewing-needs-human-confirmation', requiresApproval: true });
    }

    // 7) budget — store, and resolve conflicts to the latest value
    const bm = !/looking for|options/i.test(t) && t.match(/budget[^0-9]{0,12}(\d{1,3})\s*k|now\s+(\d{1,3})\s*k|under\s+(\d{1,3})\s*k/);
    if (bm) {
      const num = bm[1] || bm[2] || bm[3];
      const val = num + 'k';
      if (th.budget && th.budget !== val) {
        const existing = DB.memories.find(m => m.id && th.memIds.includes(m.id) && /budget/i.test(m.entry));
        if (existing) existing.entry = 'Budget updated: ' + val + ' KES (was ' + th.budget + ')';
        else addMem('Client preference', 'Budget updated: ' + val + ' KES');
        th.budget = val;
        log('MEMORY_UPDATED', 'Budget for ' + from + ' changed to ' + val + ' — memory bank updated, old value superseded.');
        const current = props().filter(p => Number(p.rent) <= Number(num) * 1000);
        return out('Noted — I have updated your budget to ' + val + ' and replaced the old figure in the memory bank. ' + (current.length ? 'Verified listings in range: ' + current.map(p => p.title + ' (' + Number(p.rent).toLocaleString('en-KE') + ' KES)').join(', ') + '.' : 'I do not currently have verified listings in that budget, so I will not invent recommendations.') + ' A team member can confirm suitable options.', { intent: 'budget-update' });
      }
      th.budget = th.budget || val;
      addMem('Client preference', 'Budget: ' + val + ' KES');
      const inventory = props();
      const fit = inventory.filter(p => Number(p.rent) <= parseInt(num, 10) * 1000);
      return out('Saved — your budget of ' + val + ' KES is now in the memory bank. ' + (fit.length ? 'In your range: ' + fit.map(p => p.title + ' (' + Number(p.rent).toLocaleString('en-KE') + ' KES)').join(', ') + '.' : 'No verified listing currently matches that budget. I will not invent alternatives; an agent can check the latest inventory.') + ' Would you like to arrange a viewing?', { intent: 'budget-saved' });
    }

    // 8) stated preferences
    if (/parking|water tank|prefer|only care|must have|need(s)? a/i.test(t)) {
      const bits = [];
      if (/parking/i.test(t)) bits.push('parking');
      if (/water tank/i.test(t)) bits.push('backup water tank');
      if (/morning/i.test(t)) bits.push('morning viewings');
      const entry = bits.length ? 'Prefers ' + bits.join(' and ') : 'Preference noted: ' + msg.slice(0, 80);
      addMem('Client preference', entry);
      log('MEMORY_ADDED', 'Stored preference for ' + from + ' — ' + entry + '.');
      return out('Noted and stored — I will keep ' + (bits.join(' and ') || 'that') + ' in mind for every option I recommend to you.', { intent: 'preference-stored' });
    }

    // 9) availability / search
    if (/available|options|looking for|apartment|house|3br|2br|4br|office|under\s*\d/i.test(t)) {
      const wantBeds = parseInt((t.match(/(\d)\s?br/) || [])[1] || '0', 10);
      const wantArea = ['westlands', 'karen', 'kilimani', 'lavington'].find(a => t.includes(a));
      const inventory = props();
      const fits = inventory.filter(p => (!wantBeds || p.bedrooms === wantBeds) && (!wantArea || p.area.toLowerCase() === wantArea));
      if (fits.length) {
        return out('These listings are marked available based on the agency\'s recorded verification: ' + fits.map(p => p.title + ' at ' + Number(p.rent).toLocaleString('en-KE') + ' KES/month (verified ' + new Date(p.verifiedAt).toLocaleDateString('en-KE') + ')').join('; ') + '. Please confirm current availability with the agent before making a commitment.', { intent: 'availability' });
      }
      const alts = inventory.filter(p => !wantBeds || p.bedrooms <= wantBeds + 1).slice(0, 3);
      if (!inventory.length) return out('I cannot verify live property availability yet because the agency inventory has no currently verified listings. I have not invented property options. I can ask an agent to follow up with confirmed matches.', { intent: 'inventory-unavailable', requiresApproval: true });
      return out('I could not find an exact match' + (wantBeds ? ' for a ' + wantBeds + 'BR' : '') + (wantArea ? ' in ' + wantArea : '') + '. Verified alternatives: ' + (alts.map(p => p.title + ' at ' + Number(p.rent).toLocaleString('en-KE') + ' KES/month').join('; ') || 'Please ask an agent to review other options.') + '.', { intent: 'alternatives' });
    }

    // 10) default — helpful, memory-aware
    const memHint = th.memIds.length ? ' I still have your earlier notes (' + th.memIds.map(id => (DB.memories.find(m => m.id === id) || {}).entry).filter(Boolean).slice(0, 2).join('; ') + ').' : '';
    return out('Thanks for your message — I can help with availability, pricing, viewing bookings, or lease terms.' + memHint + ' What would you like to do next?', { intent: 'fallback' });
  });
};
