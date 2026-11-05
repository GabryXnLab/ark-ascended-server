-- Gli indirizzi già aggiunti dall'amministratore come inviti pendenti diventano
-- autorizzazioni dirette. Le colonne token restano riservate alla futura feature
-- opzionale di notifica/invito via email.
update public.arksa_members
set status = 'accepted',
    invitation_token_hash = null,
    invitation_expires_at = null,
    responded_at = coalesce(responded_at, now())
where status = 'pending';
