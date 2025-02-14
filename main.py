import os

import pandas
import openpyxl
from openpyxl.writer.excel import save_workbook

SOURCE_FOLDER = 'docs'
FIXED_FOLDER = 'fixed'

EMPLOYEES_FILE = 'Сотрудники'
CITIES_FILE = 'Города'

EMPLOYEES_SHEET_NAME = 'Данные'
CITIES_SHEET_NAME = 'Данные'

RAW_EMPLOYEE_FILE_PATH = f'{SOURCE_FOLDER}/{EMPLOYEES_FILE}.xlsx'
CITIES_FILE_PATH = f'{SOURCE_FOLDER}/{CITIES_FILE}.xlsx'

FIXED_EMPLOYEE_FILE_PATH = (f'{SOURCE_FOLDER}/'
                            f'{FIXED_FOLDER}/'
                            f'{EMPLOYEES_FILE}_fixed.xlsx')

RAW_EMPLOYEE_DATA = pandas.read_excel(
                                        RAW_EMPLOYEE_FILE_PATH,
                                        sheet_name=EMPLOYEES_SHEET_NAME
                                     )

RAW_CITIES_DATA = pandas.read_excel(
                                        CITIES_FILE_PATH,
                                        sheet_name=CITIES_SHEET_NAME
                                     )

def create_or_open(old_file_path = None, new_file_path = None):

    if new_file_path is None:
        new_file_path = FIXED_EMPLOYEE_FILE_PATH

    if old_file_path is None:
        old_file_path = RAW_EMPLOYEE_FILE_PATH

    if not os.path.exists(new_file_path):
        raw_data = pandas.read_excel(old_file_path)
        raw_data.to_excel(
                            new_file_path,
                            sheet_name=EMPLOYEES_SHEET_NAME,
                            index=False
                          )

    return pandas.read_excel(
                                new_file_path,
                                sheet_name=EMPLOYEES_SHEET_NAME,
                           )

FIXED_EMPLOYEE_DATA = create_or_open()


def add_new_list(list_name, file_path = None):

    if file_path is None:
        file_path = FIXED_EMPLOYEE_FILE_PATH

    wb = openpyxl.load_workbook(file_path)
    wb.create_sheet(list_name)
    save_workbook(wb, file_path)

def get_titles_dict():
    new_dict = {}

    for index in range(0, len(FIXED_EMPLOYEE_DATA['ID должности']) - 1):

        isTitle = pandas.isna(FIXED_EMPLOYEE_DATA.loc[index, 'Должность'])

        if isTitle:
            continue

        title_id = FIXED_EMPLOYEE_DATA.loc[index, 'ID должности']

        if title_id not in new_dict:
            new_dict[int(title_id)] = FIXED_EMPLOYEE_DATA.loc[
                index, 'Должность']
    return new_dict

def get_pos_city_dict():
    new_dict = {}

    for index in range(0, len(FIXED_EMPLOYEE_DATA['ID должности']) - 1):

        isTitle = pandas.isna(FIXED_EMPLOYEE_DATA.loc[index, 'Должность'])

        if isTitle:
            continue

        title_id = FIXED_EMPLOYEE_DATA.loc[index, 'ID должности']

        if title_id not in new_dict:
            new_dict[int(title_id)] = {
                'pos': FIXED_EMPLOYEE_DATA.loc[index, 'Должность'],
                'city': FIXED_EMPLOYEE_DATA.loc[index, 'Город']
            }
    return new_dict

def save_excel(path = None, sheet_name = None):
    if path is None:
        path = FIXED_EMPLOYEE_FILE_PATH

    if sheet_name is None:
        sheet_name = EMPLOYEES_SHEET_NAME

    FIXED_EMPLOYEE_DATA.to_excel(
        path,
        sheet_name=sheet_name,
        index=False
    )

def change_data_format():

    FIXED_EMPLOYEE_DATA['Период'] = pandas.to_datetime(
                                            FIXED_EMPLOYEE_DATA['Период'],
                                            unit='D',
                                            origin='1899-12-30'
                                        )

    save_excel()

def fix_title_id():

    for index in range(0, len(FIXED_EMPLOYEE_DATA['ID должности']) - 1):
        title_id = FIXED_EMPLOYEE_DATA['ID должности'][index]

        if not isinstance(title_id, int):
            FIXED_EMPLOYEE_DATA.loc[index, 'ID должности'] = (
                int(title_id.split(',')[0]))

    save_excel()

def find_duplicates():

    new_set = set()

    for index in range(0, len(FIXED_EMPLOYEE_DATA['ID должности']) - 1):
        ab_cols_sum = (f'{FIXED_EMPLOYEE_DATA.loc[index, 'Период']} '
                       f'{FIXED_EMPLOYEE_DATA.loc[index, 'ID должности']}')


        if ab_cols_sum not in new_set:
            new_set.add(ab_cols_sum)
            continue

        print(ab_cols_sum)

def fix_empty_titles():

    new_dict = {}

    for index in range(0, len(FIXED_EMPLOYEE_DATA['ID должности']) - 1):

        isTitle = pandas.isna(FIXED_EMPLOYEE_DATA.loc[index, 'Должность'])

        if isTitle:
            continue

        title_id = FIXED_EMPLOYEE_DATA.loc[index, 'ID должности']

        if title_id not in new_dict:
            new_dict[int(title_id)] = FIXED_EMPLOYEE_DATA.loc[index, 'Должность']


    for index in range(0, len(FIXED_EMPLOYEE_DATA['ID должности']) - 1):

        isTitle = pandas.isna(FIXED_EMPLOYEE_DATA.loc[index, 'Должность'])

        if isTitle:

            isTable_number = (
                pandas.isna(FIXED_EMPLOYEE_DATA.loc[index, 'Табельный номер']))

            if isTable_number:
                continue

            title_id = FIXED_EMPLOYEE_DATA.loc[index, 'ID должности']

            FIXED_EMPLOYEE_DATA.loc[index, 'Должность'] = new_dict[title_id]

    save_excel()

def set_reserve():

    titles_dict = get_titles_dict()

    for index in range(len(FIXED_EMPLOYEE_DATA['ID должности']) - 1, -1, -1):

        title_id = FIXED_EMPLOYEE_DATA.loc[index, 'ID должности']

        if title_id not in titles_dict:
            FIXED_EMPLOYEE_DATA.loc[index, 'Табельный номер'] = '«Резерв»'
            FIXED_EMPLOYEE_DATA.loc[index, 'Должность'] = '«Резерв»'

    save_excel()

def add_regions():

    FIXED_EMPLOYEE_DATA['Регион'] = ''
    FIXED_EMPLOYEE_DATA['Федеральный округ'] = ''

    for i in range(0, len(FIXED_EMPLOYEE_DATA) - 1):
        for j in range(0, len(RAW_CITIES_DATA) - 1):
            if FIXED_EMPLOYEE_DATA.loc[i, 'Город'] == RAW_CITIES_DATA.loc[j, 'Город']:
                FIXED_EMPLOYEE_DATA.loc[i, 'Регион'] = RAW_CITIES_DATA.loc[j, 'Регион']
                FIXED_EMPLOYEE_DATA.loc[i, 'Федеральный округ'] = RAW_CITIES_DATA.loc[j, 'Федеральный округ']
                break

    save_excel()

def position_downtime():

    titles = get_titles_dict()

    temp_dict = {}

    for index in range(0, len(FIXED_EMPLOYEE_DATA) - 1):

        isNumber = (
            pandas.isna(FIXED_EMPLOYEE_DATA.loc[index, 'Табельный номер']))

        if isNumber:

            title_id = int(FIXED_EMPLOYEE_DATA.loc[index, 'ID должности'])

            if title_id not in temp_dict:
                temp_dict[title_id] = 1
                continue

            temp_dict[title_id] += 1



    finished_dict = {
        'ID Должности': [],
        'Должность': [],
        'Простой в месяцах': [],
    }

    for i in temp_dict:

        title_name = titles[i]
        time = temp_dict[i]

        finished_dict['ID Должности'].append(i)
        finished_dict['Должность'].append(title_name)
        finished_dict['Простой в месяцах'].append(time)

    df = pandas.DataFrame(finished_dict)

    with pandas.ExcelWriter(FIXED_EMPLOYEE_FILE_PATH, mode='a',
                        engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='Position downtime', index=False)

def fill_cities():
    data = get_pos_city_dict()

    for i in range(0, len(FIXED_EMPLOYEE_DATA) - 1):

        isCity = pandas.isna(FIXED_EMPLOYEE_DATA.loc[i, 'Город'])

        if isCity:
            pos_id = FIXED_EMPLOYEE_DATA.loc[i, 'ID должности']
            FIXED_EMPLOYEE_DATA.loc[i, 'Город'] = data[pos_id]['city']

    save_excel()

if __name__ == '__main__':

    # fill_cities()

    # add_regions()

    # fix_title_id()

    # find_duplicates()

    # change_data_format()

    # fix_empty_titles()

    # set_reserve()

    # position_downtime()



    pass