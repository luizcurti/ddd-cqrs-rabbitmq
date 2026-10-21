import EventInterface from "../../@shared/event/event.interface";

export default class ProductCreatedEvent implements EventInterface {
  dateTimeOccurred: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  eventData: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(eventData: any) {
    this.dateTimeOccurred = new Date();
    this.eventData = eventData;
  }
}
