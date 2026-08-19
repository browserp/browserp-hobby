-- Remove the remaining FiveM-only wording from the existing top house advert.
begin;

update public.ad_campaigns
set headline='Advertise your roleplay community here',
    body='Place a reviewed picture campaign across BrowseRP without disrupting organic server discovery.',
    updated_at=timezone('utc',now()),
    version=version+1
where name='BrowseRP house advert'
  and placement='top'
  and headline='Advertise your FiveM community here';

commit;
