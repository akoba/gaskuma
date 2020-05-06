function _checkBusinessDay(day)
{
  var weekday = day.getDay();
  if (weekday == 0 || weekday == 6) {
    return false;
  }
  var calendar = CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com');
  if (calendar.getEventsForDay(day, {max: 1}).length > 0) {
    return false;
  }
  return true;
}

function check()
{
  _checkBusinessDay(new Date());
}