import matplotlib.pyplot as plt
import pandas

SOURCE_FOLDER = 'docs'
FIXED_FOLDER = 'fixed'

EMPLOYEES_FILE = 'Сотрудники'
CITIES_FILE = 'Города'

EMPLOYEES_SHEET_NAME = 'Данные'
CITIES_SHEET_NAME = 'Данные'

FIXED_EMPLOYEE_FILE_PATH = (f'{SOURCE_FOLDER}/'
                            f'{FIXED_FOLDER}/'
                            f'{EMPLOYEES_FILE}_fixed.xlsx')

FIXED_EMPLOYEE_DATA = pandas.read_excel(
                                FIXED_EMPLOYEE_FILE_PATH,
                                sheet_name=EMPLOYEES_SHEET_NAME,
                           )

def regions_active_employees():
    """
    Количество действующих сотрудников по Федеральным округам;
    """

    fig, ax = plt.subplots(figsize=(5, 2.7), layout='constrained')

    new_dict = {}

    for i in range(0, len(FIXED_EMPLOYEE_DATA)):
        f_o = FIXED_EMPLOYEE_DATA.loc[i, 'Федеральный округ']
        t_n = FIXED_EMPLOYEE_DATA.loc[i, 'Табельный номер']

        if pandas.isna(f_o):
            continue

        if f_o not in new_dict:
            new_dict[f_o] = 0

        if t_n:
            new_dict[f_o] += 1

    arr = [[],[]]

    for i in new_dict:
        arr[0].append(str(i))
        arr[1].append(int(new_dict[i]))

    ax.bar(arr[0], arr[1])

    print(arr[0])
    print(arr[1])

    # plt.show()

def regions_free_positions():
    """
    Количество свободных должностей по регионам.
    """

    fig, ax = plt.subplots(figsize=(5, 2.7), layout='constrained')

    new_dict = {}

    for i in range(0, len(FIXED_EMPLOYEE_DATA)):
        f_o = FIXED_EMPLOYEE_DATA.loc[i, 'Федеральный округ']
        t_n = FIXED_EMPLOYEE_DATA.loc[i, 'Табельный номер']


        if pandas.isna(t_n):

            if f_o not in new_dict:
                new_dict[f_o] = 0

            new_dict[f_o] += 1


    arr = [[], []]

    for i in new_dict:
        arr[0].append(str(i))
        arr[1].append(int(new_dict[i]))

    ax.bar(arr[0], arr[1])

    print(arr[0])
    print(arr[1])

    # plt.show()

if __name__ == "__main__":

    regions_active_employees()

    regions_free_positions()

    pass