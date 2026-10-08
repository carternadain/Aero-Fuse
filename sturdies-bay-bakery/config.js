/* ------------------------------------------------------------------
   Site settings. Edit this file to update hours and links; the page
   picks the changes up on its own.
   ------------------------------------------------------------------ */
window.SITE = {
  /* Opening hours in island time (America/Vancouver), 24-hour clock.
     One entry per day: [open, close], or null when closed all day.
     Half hours work too, e.g. [7.5, 15] is 7:30am to 3pm.
     While this is null the "Open now" badge stays hidden and the
     Visit section shows the general hours text instead.

     Example:
     hours: {
       mon: [7, 15], tue: [7, 15], wed: [7, 15], thu: [7, 15],
       fri: [7, 16], sat: [8, 16], sun: [8, 15]
     },
  */
  hours: null,

  /* Instagram handle without the @, e.g. "sturdiesbaybakery".
     Leave empty to hide the Instagram links. */
  instagram: ""
};
